import Decimal from "decimal.js";
import { prisma } from "@/lib/prisma";

export interface MonthlyTotal {
  /** `yyyy-mm` */
  month: string;
  income: number;
  expense: number;
  savingsRatePct: number | null;
}

export interface CategoryAverage {
  id: string;
  name: string;
  color: string;
  /** Média mensal de gasto no período analisado. */
  monthlyAverage: number;
  total: number;
}

export interface TopExpense {
  id: string;
  date: string;
  description: string;
  amount: number;
  category: string | null;
}

export interface ReportsData {
  months: MonthlyTotal[];
  categoryAverages: CategoryAverage[];
  topExpenses: TopExpense[];
  avgSavingsRatePct: number | null;
}

function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/**
 * Relatórios dos últimos `monthsBack` meses: comparativo mês a mês de
 * receita/despesa, média mensal por categoria e maiores despesas — tudo
 * agregado no SQL (`groupBy`), bounded ao período.
 */
export async function getReportsData(monthsBack = 6): Promise<ReportsData> {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (monthsBack - 1), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));

  const [totals, expensesByCategory, biggest] = await Promise.all([
    prisma.transaction.groupBy({
      by: ["type", "date"],
      where: {
        account: { isActive: true },
        date: { gte: from, lte: to },
        type: { in: ["INCOME", "EXPENSE"] },
      },
      _sum: { amount: true },
    }),
    prisma.transaction.groupBy({
      by: ["categoryId"],
      where: {
        account: { isActive: true },
        date: { gte: from, lte: to },
        type: "EXPENSE",
      },
      _sum: { amount: true },
    }),
    prisma.transaction.findMany({
      where: {
        account: { isActive: true },
        date: { gte: from, lte: to },
        type: "EXPENSE",
      },
      orderBy: { amount: "asc" }, // despesas são negativas: as maiores vêm primeiro
      take: 10,
      select: {
        id: true,
        date: true,
        description: true,
        amount: true,
        category: { select: { name: true } },
      },
    }),
  ]);

  // --- Comparativo mês a mês ---
  const byMonth = new Map<string, { income: Decimal; expense: Decimal }>();
  for (let i = 0; i < monthsBack; i += 1) {
    const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + i, 1));
    byMonth.set(monthKey(d), { income: new Decimal(0), expense: new Decimal(0) });
  }
  for (const row of totals) {
    const key = monthKey(row.date);
    const bucket = byMonth.get(key);
    if (!bucket) continue;
    const amount = new Decimal(row._sum.amount?.toString() ?? "0");
    if (row.type === "INCOME") bucket.income = bucket.income.plus(amount);
    else bucket.expense = bucket.expense.plus(amount.abs());
  }
  const months: MonthlyTotal[] = Array.from(byMonth.entries()).map(([month, bucket]) => ({
    month,
    income: bucket.income.toDecimalPlaces(2).toNumber(),
    expense: bucket.expense.toDecimalPlaces(2).toNumber(),
    savingsRatePct: bucket.income.isZero()
      ? null
      : bucket.income.minus(bucket.expense).dividedBy(bucket.income).toNumber(),
  }));

  const totalIncome = months.reduce((s, m) => s + m.income, 0);
  const totalExpense = months.reduce((s, m) => s + m.expense, 0);
  const avgSavingsRatePct = totalIncome > 0 ? (totalIncome - totalExpense) / totalIncome : null;

  // --- Média mensal por categoria ---
  const categories = await prisma.category.findMany({
    where: { id: { in: expensesByCategory.map((r) => r.categoryId).filter((id): id is string => !!id) } },
    select: { id: true, name: true, color: true },
  });
  const categoryById = new Map(categories.map((c) => [c.id, c]));

  const categoryAverages: CategoryAverage[] = expensesByCategory
    .map((row) => {
      const total = new Decimal(row._sum.amount?.toString() ?? "0").abs();
      const category = row.categoryId ? categoryById.get(row.categoryId) : undefined;
      return {
        id: row.categoryId ?? "uncategorized",
        name: category?.name ?? "Sem categoria",
        color: category?.color ?? "var(--muted-foreground)",
        total: total.toDecimalPlaces(2).toNumber(),
        monthlyAverage: total.dividedBy(monthsBack).toDecimalPlaces(2).toNumber(),
      };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, 12);

  const topExpenses: TopExpense[] = biggest.map((row) => ({
    id: row.id,
    date: row.date.toISOString(),
    description: row.description,
    amount: new Decimal(row.amount.toString()).abs().toNumber(),
    category: row.category?.name ?? null,
  }));

  return { months, categoryAverages, topExpenses, avgSavingsRatePct };
}
