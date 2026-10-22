import Decimal from "decimal.js";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { toDecimal } from "@/lib/money";
import type { PeriodRange } from "@/lib/period";

function toIsoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export interface DailyBalancePoint {
  date: string;
  /** `null` para dias futuros (ainda não realizados). */
  realized: number | null;
  /** Sempre presente — no passado é igual ao realizado, no futuro usa lançamentos já conhecidos (parcelas futuras). */
  projected: number;
}

export interface DashboardData {
  netWorth: number;
  netWorthSparkline: number[];
  income: number;
  expense: number;
  savingsRatePct: number | null;
  dailyBurnRate: number;
  dailyBalanceSeries: DailyBalancePoint[];
  categoryBreakdown: Array<{ id: string; name: string; color: string; total: number }>;
  hasAnyTransaction: boolean;
}

/**
 * Consolida os dados do Dashboard para o período selecionado. Todo o
 * cálculo intermediário roda em `Decimal` — a conversão para `number` só
 * acontece no fim, na fronteira com os componentes de gráfico (Recharts
 * exige `number` primitivo).
 */
export async function getDashboardData(range: PeriodRange): Promise<DashboardData> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const activeInPeriod = {
    account: { isActive: true },
    date: { gte: range.from, lte: range.to },
  } satisfies Prisma.TransactionWhereInput;

  // Tudo agregado no banco e em paralelo: o custo depende do tamanho do
  // período, não do histórico inteiro (antes eram carregadas todas as
  // transações desde o início só para montar a série diária).
  const [accounts, balanceBeforeRange, dailyTotals, periodTotals, categories, anyTransaction] = await Promise.all([
    prisma.account.findMany({ where: { isActive: true }, select: { initialBalance: true, currentBalance: true } }),
    prisma.transaction.aggregate({
      where: { account: { isActive: true }, date: { lt: range.from } },
      _sum: { amount: true },
    }),
    // Datas gravadas em UTC (timestamp sem fuso): os limites vão como
    // instantes UTC e o dia sai como texto, sem depender do fuso da sessão.
    prisma.$queryRaw<Array<{ day: string; total: string }>>`
      SELECT to_char(date_trunc('day', t."date"), 'YYYY-MM-DD') AS day, SUM(t."amount")::text AS total
      FROM "transactions" t
      JOIN "accounts" a ON a.id = t."accountId"
      WHERE a."isActive"
        AND t."date" >= (${range.from.toISOString()}::timestamptz AT TIME ZONE 'UTC')
        AND t."date" <= (${range.to.toISOString()}::timestamptz AT TIME ZONE 'UTC')
      GROUP BY 1`,
    prisma.transaction.groupBy({
      by: ["type", "categoryId"],
      where: { ...activeInPeriod, type: { in: ["INCOME", "EXPENSE"] } },
      _sum: { amount: true },
    }),
    prisma.category.findMany({ select: { id: true, name: true, color: true } }),
    prisma.transaction.findFirst({ select: { id: true } }),
  ]);

  const netWorth = accounts.reduce((sum, a) => sum.plus(a.currentBalance.toString()), new Decimal(0));
  const initialBalanceSum = accounts.reduce(
    (sum, a) => sum.plus(a.initialBalance.toString()),
    new Decimal(0),
  );

  // --- Série diária de saldo acumulado (realizado x projetado) ---
  const totalByDay = new Map(dailyTotals.map((row) => [row.day, toDecimal(row.total)]));
  const dailyBalanceSeries: DailyBalancePoint[] = [];
  let carry = initialBalanceSum.plus(balanceBeforeRange._sum.amount?.toString() ?? "0");

  for (let cursor = new Date(range.from); cursor <= range.to; cursor = addDays(cursor, 1)) {
    const day = toIsoDay(cursor);
    const dayTotal = totalByDay.get(day);
    if (dayTotal) carry = carry.plus(dayTotal);
    const isFuture = cursor > today;
    dailyBalanceSeries.push({
      date: day,
      realized: isFuture ? null : carry.toDecimalPlaces(2).toNumber(),
      projected: carry.toDecimalPlaces(2).toNumber(),
    });
  }

  const netWorthSparkline = dailyBalanceSeries.map((point) => point.projected);

  // --- Entradas vs Saídas do período (exclui TRANSFER/ADJUSTMENT) ---
  let income = new Decimal(0);
  let expense = new Decimal(0);
  for (const row of periodTotals) {
    const amount = toDecimal(row._sum.amount?.toString() ?? "0");
    if (row.type === "INCOME") income = income.plus(amount);
    if (row.type === "EXPENSE") expense = expense.plus(amount);
  }

  const savingsRatePct = income.isZero() ? null : income.plus(expense).dividedBy(income).toNumber();

  const daysElapsed = Math.max(
    1,
    Math.min(
      Math.floor((Math.min(today.getTime(), range.to.getTime()) - range.from.getTime()) / 86_400_000) + 1,
      Math.floor((range.to.getTime() - range.from.getTime()) / 86_400_000) + 1,
    ),
  );
  const dailyBurnRate = expense.abs().dividedBy(daysElapsed).toDecimalPlaces(2).toNumber();

  // --- Despesas por categoria ---
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const categoryBreakdown = periodTotals
    .filter((row) => row.type === "EXPENSE")
    .map((row) => {
      const category = row.categoryId ? categoryById.get(row.categoryId) : undefined;
      return {
        id: row.categoryId ?? "uncategorized",
        name: category?.name ?? "Sem categoria",
        color: category?.color ?? "var(--muted-foreground)",
        total: toDecimal(row._sum.amount?.toString() ?? "0").abs().toNumber(),
      };
    })
    .sort((a, b) => b.total - a.total);

  return {
    netWorth: netWorth.toDecimalPlaces(2).toNumber(),
    netWorthSparkline,
    income: income.toDecimalPlaces(2).toNumber(),
    expense: expense.toDecimalPlaces(2).toNumber(),
    savingsRatePct,
    dailyBurnRate,
    dailyBalanceSeries,
    categoryBreakdown,
    hasAnyTransaction: anyTransaction !== null,
  };
}
