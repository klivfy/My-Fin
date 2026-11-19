import Decimal from "decimal.js";
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

  const [accounts, transactionsUpToRangeEnd, totalTransactionCount] = await Promise.all([
    prisma.account.findMany({ where: { isActive: true }, select: { initialBalance: true, currentBalance: true } }),
    prisma.transaction.findMany({
      where: { account: { isActive: true }, date: { lte: range.to } },
      select: { date: true, amount: true },
      orderBy: { date: "asc" },
    }),
    prisma.transaction.count(),
  ]);

  const netWorth = accounts.reduce((sum, a) => sum.plus(a.currentBalance.toString()), new Decimal(0));
  const initialBalanceSum = accounts.reduce(
    (sum, a) => sum.plus(a.initialBalance.toString()),
    new Decimal(0),
  );

  // --- Série diária de saldo acumulado (realizado x projetado) ---
  const balanceByDay = new Map<string, Decimal>();
  let running = initialBalanceSum;
  for (const tx of transactionsUpToRangeEnd) {
    running = running.plus(tx.amount.toString());
    const day = toIsoDay(tx.date);
    balanceByDay.set(day, running); // última ocorrência do dia vence — ordenado asc
  }

  const dailyBalanceSeries: DailyBalancePoint[] = [];
  let carry = initialBalanceSum;
  // Preenche o saldo acumulado de todo dia anterior ao início do período
  // (para o carry-forward começar correto), sem emitir esses pontos.
  for (const [day, value] of balanceByDay) {
    if (day < toIsoDay(range.from)) carry = value;
  }

  for (let cursor = new Date(range.from); cursor <= range.to; cursor = addDays(cursor, 1)) {
    const day = toIsoDay(cursor);
    if (balanceByDay.has(day)) carry = balanceByDay.get(day)!;
    const isFuture = cursor > today;
    dailyBalanceSeries.push({
      date: day,
      realized: isFuture ? null : carry.toDecimalPlaces(2).toNumber(),
      projected: carry.toDecimalPlaces(2).toNumber(),
    });
  }


  // --- Entradas vs Saídas do período (exclui TRANSFER/ADJUSTMENT) ---
  const periodTransactions = await prisma.transaction.findMany({
    where: {
      account: { isActive: true },
      date: { gte: range.from, lte: range.to },
      type: { in: ["INCOME", "EXPENSE"] },
    },
    select: { amount: true, type: true, categoryId: true, category: { select: { name: true, color: true } } },
  });

  const income = periodTransactions
    .filter((t) => t.type === "INCOME")
    .reduce((sum, t) => sum.plus(t.amount.toString()), new Decimal(0));
  const expense = periodTransactions
    .filter((t) => t.type === "EXPENSE")
    .reduce((sum, t) => sum.plus(t.amount.toString()), new Decimal(0));

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
  const breakdownMap = new Map<string, { name: string; color: string; total: Decimal }>();
  for (const t of periodTransactions) {
    if (t.type !== "EXPENSE") continue;
    const key = t.categoryId ?? "uncategorized";
    const existing = breakdownMap.get(key);
    const amountAbs = toDecimal(t.amount.toString()).abs();
    if (existing) {
      existing.total = existing.total.plus(amountAbs);
    } else {
      breakdownMap.set(key, {
        name: t.category?.name ?? "Sem categoria",
        color: t.category?.color ?? "var(--muted-foreground)",
        total: amountAbs,
      });
    }
  }
  const categoryBreakdown = Array.from(breakdownMap.entries())
    .map(([id, value]) => ({ id, name: value.name, color: value.color, total: value.total.toNumber() }))
    .sort((a, b) => b.total - a.total);

  return {
    netWorth: netWorth.toDecimalPlaces(2).toNumber(),
    income: income.toDecimalPlaces(2).toNumber(),
    expense: expense.toDecimalPlaces(2).toNumber(),
    savingsRatePct,
    dailyBurnRate,
    dailyBalanceSeries,
    categoryBreakdown,
    hasAnyTransaction: totalTransactionCount > 0,
  };
}
