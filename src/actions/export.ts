"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { assertAuthorized } from "@/lib/auth";

/**
 * Exportação de dados para portabilidade/backup.
 *
 * - `exportTransactionsCsv`: CSV do extrato com os MESMOS filtros da tela
 *   (conta, categoria, tipo, busca) — limitado a 50k linhas por segurança.
 * - `exportFullBackup`: dump JSON completo (contas, categorias, transações,
 *   transferências, faturas, regras, metas, agendamentos).
 *
 * São Server Actions (não Route Handlers) para herdar o `assertAuthorized`
 * e o download é disparado pelo cliente a partir da string retornada.
 */

const exportCsvSchema = z.object({
  accountId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  type: z.enum(["INCOME", "EXPENSE", "TRANSFER", "ADJUSTMENT"]).optional(),
  search: z.string().optional(),
});

function csvEscape(value: string): string {
  return /[",;\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export async function exportTransactionsCsv(input: z.infer<typeof exportCsvSchema>) {
  await assertAuthorized();
  const filters = exportCsvSchema.parse(input);

  const rows = await prisma.transaction.findMany({
    where: {
      ...(filters.accountId ? { accountId: filters.accountId } : {}),
      ...(filters.categoryId
        ? filters.categoryId === "uncategorized"
          ? { categoryId: null }
          : { categoryId: filters.categoryId }
        : {}),
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.search
        ? { description: { contains: filters.search, mode: "insensitive" as const } }
        : {}),
    },
    include: {
      account: { select: { name: true } },
      category: { select: { name: true } },
    },
    orderBy: { date: "asc" },
    take: 50_000,
  });

  const header = "data;descricao;conta;categoria;tipo;valor";
  const lines = rows.map((row) =>
    [
      row.date.toISOString().slice(0, 10),
      csvEscape(row.description),
      csvEscape(row.account.name),
      csvEscape(row.category?.name ?? ""),
      row.type,
      row.amount.toString(),
    ].join(";"),
  );
  return `${header}\n${lines.join("\n")}\n`;
}

/** Backup completo em JSON (todos os dados do tenant único). */
export async function exportFullBackup() {
  await assertAuthorized();

  const [accounts, categories, transactions, transfers, invoices, rules, goals, scheduled] =
    await Promise.all([
      prisma.account.findMany(),
      prisma.category.findMany(),
      prisma.transaction.findMany(),
      prisma.transfer.findMany(),
      prisma.creditCardInvoice.findMany(),
      prisma.categoryRule.findMany(),
      prisma.savingsGoal.findMany(),
      prisma.scheduledTransaction.findMany(),
    ]);

  // Serialização explícita: Decimal → string para não perder precisão.
  return JSON.stringify(
    {
      version: 1,
      exportedAt: new Date().toISOString(),
      accounts,
      categories,
      transactions,
      transfers,
      creditCardInvoices: invoices,
      categoryRules: rules,
      savingsGoals: goals,
      scheduledTransactions: scheduled,
    },
    (_key, value) => (typeof value === "object" && value !== null && value.constructor?.name === "Decimal" ? value.toString() : value),
    2,
  );
}
