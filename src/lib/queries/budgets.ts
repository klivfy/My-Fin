import Decimal from "decimal.js";
import { prisma } from "@/lib/prisma";
import { getRecurringData } from "@/lib/queries/recurring";
import { dailyAllowance } from "@/lib/financial-engine/daily-allowance";

export interface BudgetView {
  id: string;
  name: string;
  color: string;
  budgetLimit: number;
  spent: number;
  progressPct: number;
  expectedPct: number;
  isAcceleratedBurn: boolean;
  /** Dias até o fim do mês, contando hoje. */
  daysLeft: number;
  /** O que ainda cabe no teto dividido pelos dias restantes (0 se estourou). */
  perDayLeft: number;
  /** Recorrentes da categoria ainda não pagas no mês, já descontadas do "por dia". */
  pendingBills: number;
}

/** Orçamentos do mês corrente: gasto real (EXPENSE) vs. teto planejado por categoria. */
export async function getBudgetViews(): Promise<BudgetView[]> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
  const daysInMonth = monthEnd.getUTCDate();
  const dayOfMonth = now.getUTCDate();
  const expectedPct = dayOfMonth / daysInMonth;
  const daysLeft = daysInMonth - dayOfMonth + 1;

  const categories = await prisma.category.findMany({
    where: { type: "EXPENSE", budgetLimit: { not: null } },
    orderBy: { name: "asc" },
  });

  if (categories.length === 0) return [];

  // Contas recorrentes que ainda vão vencer: sem elas o "cabem por dia" é otimista.
  const recurring = await getRecurringData(now);
  const pendingByCategory = new Map<string, Decimal>();
  for (const e of recurring.calendar.entries) {
    if (e.status === "PAID" || !e.categoryId) continue;
    pendingByCategory.set(e.categoryId, (pendingByCategory.get(e.categoryId) ?? new Decimal(0)).plus(e.amount));
  }

  const spentByCategory = await prisma.transaction.groupBy({
    by: ["categoryId"],
    where: {
      type: "EXPENSE",
      date: { gte: monthStart, lte: monthEnd },
      categoryId: { in: categories.map((c) => c.id) },
    },
    _sum: { amount: true },
  });
  const spentMap = new Map(
    spentByCategory.map((row) => [row.categoryId, new Decimal(row._sum.amount?.toString() ?? "0").abs()]),
  );

  return categories.map((category) => {
    const limit = new Decimal(category.budgetLimit!.toString());
    const spent = spentMap.get(category.id) ?? new Decimal(0);
    const progressPct = limit.isZero() ? 0 : spent.dividedBy(limit).toNumber();
    const allowance = dailyAllowance({
      limit,
      spent,
      pendingBills: pendingByCategory.get(category.id) ?? new Decimal(0),
      daysLeft,
    });

    return {
      id: category.id,
      name: category.name,
      color: category.color ?? "var(--color-outline)",
      budgetLimit: limit.toNumber(),
      spent: spent.toNumber(),
      progressPct,
      expectedPct,
      // Ritmo acelerado: já gastou proporcionalmente mais do que o esperado
      // para o ponto atual do mês, com folga de 10pp para não alarmar por ruído.
      isAcceleratedBurn: progressPct > expectedPct + 0.1 && progressPct < 1,
      daysLeft,
      perDayLeft: allowance.perDay.toNumber(),
      pendingBills: allowance.reserved.toNumber(),
    };
  });
}
