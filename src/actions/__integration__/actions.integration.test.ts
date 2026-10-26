/**
 * Testes de integração das Server Actions contra Postgres real.
 *
 * Rodam apenas quando `DATABASE_URL` aponta para um banco acessível (CI
 * sobe um service container; local: `docker run -p 5432:5432 postgres`).
 * Sem banco, o arquivo inteiro é pulado — `npm run test` continua verde só
 * com os testes unitários.
 *
 * Cobertura dos fluxos críticos de dinheiro:
 * - createTransaction: sinais por tipo (EXPENSE negativo, INCOME positivo)
 * - createTransfer: partida dobrada (débito origem + crédito destino)
 * - deleteTransactions: atomicidade em lote + reversão de saldo
 * - auditAccountBalance: detecta e corrige drift do saldo materializado
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";

const DATABASE_URL = process.env.DATABASE_URL;
const canConnect = !!DATABASE_URL && !DATABASE_URL.includes("localhost:5432/ci");

// Server Actions importadas DEPOIS de garantir que há banco
// (o PrismaClient lazy-connect só falha ao primeiro uso).
const prisma = new PrismaClient(
  canConnect ? { datasources: { db: { url: DATABASE_URL! } } } : undefined,
);

describe.skipIf(!canConnect)("integration: Server Actions (Postgres)", () => {
  let accountA: { id: string };
  let accountB: { id: string };

  beforeAll(async () => {
    // Limpa o banco de teste (ordem respeita FKs).
    await prisma.$executeRawUnsafe(
      'TRUNCATE "audit_logs", "transactions", "transfers", "credit_card_invoices", "sync_logs", "category_rules", "savings_goals", "scheduled_transactions", "accounts", "categories" CASCADE',
    );

    const { createAccount } = await import("@/actions/accounts");
    accountA = await createAccount({ name: "Conta A", type: "CHECKING", initialBalance: "1000.00" });
    accountB = await createAccount({ name: "Conta B", type: "SAVINGS", initialBalance: "0.00" });
  }, 30_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("createTransaction aplica sinal por tipo e ajusta o saldo", async () => {
    const { createTransaction } = await import("@/actions/transactions");

    await createTransaction({
      accountId: accountA.id,
      amount: "100,00",
      type: "EXPENSE",
      description: "Teste despesa",
      date: new Date().toISOString(),
    });
    await createTransaction({
      accountId: accountA.id,
      amount: "50.00",
      type: "INCOME",
      description: "Teste receita",
      date: new Date().toISOString(),
    });

    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountA.id } });
    // 1000 - 100 + 50 = 950
    expect(account.currentBalance.toString()).toBe("950");

    const expense = await prisma.transaction.findFirstOrThrow({
      where: { accountId: accountA.id, description: "TESTE DESPESA" },
    });
    expect(expense.amount.toString()).toBe("-100");
  });

  it("createTransfer faz partida dobrada e não conta como receita/despesa", async () => {
    const { createTransfer } = await import("@/actions/transfers");
    await createTransfer({
      sourceAccountId: accountA.id,
      destinationAccountId: accountB.id,
      amount: "200.00",
      date: new Date().toISOString(),
      description: "Transferência teste",
    });

    const [a, b] = await Promise.all([
      prisma.account.findUniqueOrThrow({ where: { id: accountA.id } }),
      prisma.account.findUniqueOrThrow({ where: { id: accountB.id } }),
    ]);
    expect(a.currentBalance.toString()).toBe("750"); // 950 - 200
    expect(b.currentBalance.toString()).toBe("200");

    const legs = await prisma.transaction.findMany({ where: { type: "TRANSFER" } });
    expect(legs).toHaveLength(2);
    expect(legs.map((l) => l.amount.toString()).sort()).toEqual(["-200", "200"]);
  });

  it("deleteTransactions é atômico: uma transação bloqueada aborta o lote", async () => {
    const { deleteTransactions } = await import("@/actions/transactions");

    const transferLeg = await prisma.transaction.findFirstOrThrow({ where: { type: "TRANSFER" } });
    const manual = await prisma.transaction.findFirstOrThrow({
      where: { description: "TESTE RECEITA" },
    });

    await expect(deleteTransactions({ ids: [manual.id, transferLeg.id] })).rejects.toThrow(
      /transferência/i,
    );

    // Nada foi excluído — o lote abortou inteiro.
    const stillThere = await prisma.transaction.findUnique({ where: { id: manual.id } });
    expect(stillThere).not.toBeNull();
  });

  it("auditAccountBalance detecta e corrige drift do saldo materializado", async () => {
    // Introduz drift artificial direto no banco (bypass nas actions).
    await prisma.account.update({
      where: { id: accountB.id },
      data: { currentBalance: "999.99" },
    });

    const { auditAccountBalance } = await import("@/actions/accounts");
    const detected = await auditAccountBalance({ accountId: accountB.id, fix: false });
    expect(detected.drift).not.toBe("0.00");

    const fixed = await auditAccountBalance({ accountId: accountB.id, fix: true });
    expect(fixed.corrected).toBe(true);
    expect(fixed.expected).toBe("200.00");

    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountB.id } });
    expect(account.currentBalance.toString()).toBe("200");
  });

  it("deactivateAccount recusa conta com saldo", async () => {
    const { deactivateAccount } = await import("@/actions/accounts");
    await expect(deactivateAccount({ id: accountA.id })).rejects.toThrow(/Zere o saldo/);
  });
});
