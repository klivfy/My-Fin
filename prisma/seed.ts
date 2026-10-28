import { PrismaClient, type CategoryNature, type CategoryType, type Prisma } from "@prisma/client";
import Decimal from "decimal.js";
import { MockAdapter } from "../src/lib/financial-engine/mock-adapter";
import { hashTransactions, partitionByExistingHash } from "../src/lib/financial-engine/reconciliation";
import { matchCategory } from "../src/lib/financial-engine/categorization";
import { createInstallmentPurchase } from "../src/actions/credit-cards";

const prisma = new PrismaClient();

const DEFAULT_CATEGORIES: Array<{
  name: string;
  type: CategoryType;
  icon: string;
  color: string;
  budgetLimit?: string;
  nature?: CategoryNature;
}> = [
  { name: "Salário", type: "INCOME", icon: "wallet", color: "#0F9D58" },
  { name: "Outras Receitas", type: "INCOME", icon: "trending-up", color: "#34A853" },
  { name: "Alimentação", type: "EXPENSE", icon: "utensils", color: "#EA4335", budgetLimit: "800.00", nature: "NEED" },
  { name: "Transporte", type: "EXPENSE", icon: "car", color: "#FB8C00", budgetLimit: "400.00", nature: "NEED" },
  { name: "Moradia", type: "EXPENSE", icon: "home", color: "#8E24AA", budgetLimit: "1200.00", nature: "NEED" },
  { name: "Assinaturas", type: "EXPENSE", icon: "repeat", color: "#3949AB", budgetLimit: "250.00", nature: "WANT" },
  { name: "Lazer", type: "EXPENSE", icon: "party-popper", color: "#00ACC1", budgetLimit: "300.00", nature: "WANT" },
  { name: "Saúde", type: "EXPENSE", icon: "heart-pulse", color: "#D81B60", budgetLimit: "300.00", nature: "NEED" },
  { name: "Compras", type: "EXPENSE", icon: "shopping-bag", color: "#6D4C41", budgetLimit: "500.00", nature: "WANT" },
];

/** Regras de categorização do seed: trecho da descrição normalizada → categoria. */
const SEED_RULES: Array<{ pattern: string; category: string }> = [
  { pattern: "EMPREGADOR", category: "Salário" },
  { pattern: "NETFLIX", category: "Assinaturas" },
  { pattern: "SPOTIFY", category: "Assinaturas" },
  { pattern: "SMARTFIT", category: "Assinaturas" },
  { pattern: "CLARO NET", category: "Assinaturas" },
  { pattern: "SUPERMERCADO", category: "Alimentação" },
  { pattern: "IFOOD", category: "Alimentação" },
  { pattern: "POSTO IPIRANGA", category: "Transporte" },
  { pattern: "CONDOMINIO", category: "Moradia" },
  { pattern: "ENERGIA ELETRICA", category: "Moradia" },
  { pattern: "MAGAZINE LUIZA", category: "Compras" },
  { pattern: "AMERICANAS", category: "Compras" },
];

const INSTALLMENT_MARKERS = ["MAGAZINE LUIZA", "AMERICANAS"];

async function main() {
  console.log("→ Seed: categorias padrão");
  const categories = new Map<string, string>(); // name -> id
  for (const category of DEFAULT_CATEGORIES) {
    // Sem constraint composta única (name, type) no schema: busca-ou-cria
    // manualmente para o seed ser idempotente sem exigir upsert por chave única.
    const existing = await prisma.category.findFirst({
      where: { name: category.name, type: category.type },
    });
    const row = existing
      ? await prisma.category.update({ where: { id: existing.id }, data: category })
      : await prisma.category.create({ data: category });
    categories.set(category.name, row.id);
  }

  console.log("→ Seed: regras de categorização");
  const rules: Array<{ pattern: string; categoryId: string }> = [];
  for (const rule of SEED_RULES) {
    const categoryId = categories.get(rule.category);
    if (!categoryId) continue;
    await prisma.categorizationRule.upsert({
      where: { pattern: rule.pattern },
      create: { pattern: rule.pattern, categoryId },
      update: { categoryId },
    });
    rules.push({ pattern: rule.pattern, categoryId });
  }

  console.log("→ Seed: contas de teste");
  const checking = await upsertAccount({
    name: "Conta Corrente Itaú",
    type: "CHECKING",
    initialBalance: "5000.00",
  });
  const savings = await upsertAccount({
    name: "Poupança",
    type: "SAVINGS",
    initialBalance: "12000.00",
  });
  const creditCard = await upsertAccount({
    name: "Cartão Inter Black",
    type: "CREDIT_CARD",
    initialBalance: "0.00",
    metadata: { creditLimit: "5000.00" },
  });
  void savings;

  console.log("→ Seed: gerando 90 dias de transações via MockAdapter");
  const to = new Date();
  to.setUTCHours(0, 0, 0, 0);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 90);

  const adapter = new MockAdapter(42);
  const generated = await adapter.fetchTransactions({ from, to });

  const checkingRaw = generated.filter(
    (t) => !INSTALLMENT_MARKERS.some((marker) => t.description.includes(marker)),
  );
  const creditCardRaw = generated.filter((t) =>
    INSTALLMENT_MARKERS.some((marker) => t.description.includes(marker)),
  );

  const syncLog = await prisma.syncLog.create({
    data: { provider: "MOCK", status: "RUNNING" },
  });

  let totalInserted = 0;
  let totalSkipped = 0;

  for (const [account, raw] of [
    [checking, checkingRaw],
    [creditCard, creditCardRaw],
  ] as const) {
    const hashed = hashTransactions(account.id, raw);
    const { toInsert, duplicates } = await partitionByExistingHash(hashed);

    if (toInsert.length > 0) {
      await prisma.transaction.createMany({
        data: toInsert.map((t) => {
          const categoryId = matchCategory(t.description, rules);
          return {
            accountId: account.id,
            categoryId,
            categorizationSource: categoryId ? ("RULE" as const) : null,
            amount: t.amount.toFixed(2),
            type: t.amount.isNegative() ? ("EXPENSE" as const) : ("INCOME" as const),
            description: t.description,
            originalDescription: t.originalDescription,
            date: t.date,
            isPaid: true,
            isReconciled: true,
            reconciliationHash: t.reconciliationHash,
            syncLogId: syncLog.id,
          };
        }),
      });
    }

    totalInserted += toInsert.length;
    totalSkipped += duplicates.length;

    // Recalcula o saldo corrente a partir do zero (idempotente por construção):
    // initialBalance + soma de todas as transações reais da conta.
    const aggregate = await prisma.transaction.aggregate({
      where: { accountId: account.id },
      _sum: { amount: true },
    });
    const currentBalance = new Decimal(account.initialBalance.toString()).plus(
      aggregate._sum.amount?.toString() ?? "0",
    );
    await prisma.account.update({
      where: { id: account.id },
      data: { currentBalance: currentBalance.toFixed(2) },
    });
  }

  await prisma.syncLog.update({
    where: { id: syncLog.id },
    data: {
      status: "SUCCESS",
      recordsProcessed: generated.length,
      recordsInserted: totalInserted,
      recordsSkipped: totalSkipped,
      finishedAt: new Date(),
    },
  });

  console.log("→ Seed: compras parceladas reais no cartão (fatura/parcelamento genuínos)");
  await seedInstallmentPurchase({
    accountId: creditCard.id,
    categoryId: categories.get("Compras") ?? null,
    description: "Notebook Dell Inspiron",
    totalAmount: "3200.00",
    totalInstallments: 10,
    daysAgo: 50,
  });
  await seedInstallmentPurchase({
    accountId: creditCard.id,
    categoryId: categories.get("Lazer") ?? null,
    description: "Passagem Aérea GRU-SDU",
    totalAmount: "1200.00",
    totalInstallments: 6,
    daysAgo: 20,
  });

  console.log(
    `✔ Seed concluído: ${totalInserted} transação(ões) inserida(s), ${totalSkipped} ignorada(s) por deduplicação.`,
  );
}

async function upsertAccount(input: {
  name: string;
  type: "CHECKING" | "SAVINGS" | "CREDIT_CARD";
  initialBalance: string;
  metadata?: Prisma.InputJsonValue;
}) {
  const existing = await prisma.account.findFirst({ where: { name: input.name } });
  if (existing) return existing;
  return prisma.account.create({
    data: {
      name: input.name,
      type: input.type,
      initialBalance: input.initialBalance,
      currentBalance: input.initialBalance,
      metadata: input.metadata,
    },
  });
}

/**
 * Cria uma compra parcelada real reaproveitando `createInstallmentPurchase`
 * (Server Action da Fase 3) — evita duplicar a matemática de fatura/parcela
 * no seed. `revalidatePath` lança fora de uma requisição Next.js real; como
 * a ação já persistiu tudo antes de chamá-lo, o erro é ignorado aqui com
 * segurança (idêntico ao comportamento validado no smoke test da Fase 3).
 */
async function seedInstallmentPurchase(input: {
  accountId: string;
  categoryId: string | null;
  description: string;
  totalAmount: string;
  totalInstallments: number;
  daysAgo: number;
}) {
  const existing = await prisma.transaction.findFirst({
    where: { accountId: input.accountId, originalDescription: input.description },
  });
  if (existing) return;

  const date = new Date();
  date.setUTCDate(date.getUTCDate() - input.daysAgo);

  try {
    await createInstallmentPurchase({
      accountId: input.accountId,
      categoryId: input.categoryId,
      description: input.description,
      totalAmount: input.totalAmount,
      totalInstallments: input.totalInstallments,
      date,
    });
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("static generation store")) {
      throw error;
    }
  }
}

main()
  .catch((error) => {
    console.error("✘ Seed falhou:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
