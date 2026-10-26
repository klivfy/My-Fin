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
 *
 * Escala: nenhuma query varre o histórico inteiro. O ponto de partida da
 * série diária é o `currentBalance` materializado (invariante mantido
 * atomicamente pelas Server Actions) menos a movimentação do próprio
 * período — agregada no SQL com `groupBy` por dia.
 */
export async function getDashboardData(range: PeriodRange): Promise<DashboardData> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const [accounts, totalsByType, totalTransactionCount, movementAfterRange] = await Promise.all([
    prisma.account.findMany({
      where: { isActive: true },
      select: { currentBalance: true },
    }),
    // Receita/despesa do período agregadas no banco (sem trazer linhas).
    prisma.transaction.groupBy({
      by: ["type"],
      where: {
        account: { isActive: true },
        date: { gte: range.from, lte: range.to },
        type: { in: ["INCOME", "EXPENSE"] },
      },
      _sum: { amount: true },
    }),
    prisma.transaction.count(),
    // Movimento POSTERIOR ao período (parcelas futuras, lançamentos
    // agendados): precisa ser descontado do saldo materializado para obter
    // o saldo exato no fim do período exibido. Agregado no SQL.
    prisma.transaction.aggregate({
      where: { account: { isActive: true }, date: { gt: range.to } },
      _sum: { amount: true },
    }),
  ]);

  const netWorth = accounts.reduce((sum, a) => sum.plus(a.currentBalance.toString()), new Decimal(0));

  const income = totalsByType
    .filter((row) => row.type === "INCOME")
    .reduce((sum, row) => sum.plus(row._sum.amount?.toString() ?? "0"), new Decimal(0));
  const expense = totalsByType
    .filter((row) => row.type === "EXPENSE")
    .reduce((sum, row) => sum.plus(row._sum.amount?.toString() ?? "0"), new Decimal(0));

  const savingsRatePct = income.isZero() ? null : income.plus(expense).dividedBy(income).toNumber();

  const daysElapsed = Math.max(
    1,
    Math.min(
      Math.floor((Math.min(today.getTime(), range.to.getTime()) - range.from.getTime()) / 86_400_000) + 1,
      Math.floor((range.to.getTime() - range.from.getTime()) / 86_400_000) + 1,
    ),
  );
  const dailyBurnRate = expense.abs().dividedBy(daysElapsed).toDecimalPlaces(2).toNumber();

  // --- Série diária de saldo acumulado (realizado x projetado) ---
  // Apenas as transações do período visível são buscadas (bounded), já
  // agregadas por dia no SQL. O carry-forward inicial é derivado do saldo
  // materializado: saldo(range.to) = netWorth - movimento posterior ao
  // período; saldo de abertura = saldo(range.to) - movimento do período.
  const dailyDeltas = await prisma.transaction.groupBy({
    by: ["date"],
    where: { account: { isActive: true }, date: { gte: range.from, lte: range.to } },
    _sum: { amount: true },
  });

  const periodMovement = dailyDeltas.reduce(
    (sum, row) => sum.plus(row._sum.amount?.toString() ?? "0"),
    new Decimal(0),
  );
  const balanceAtRangeEnd = netWorth.minus(movementAfterRange._sum.amount?.toString() ?? "0");
  let carry = balanceAtRangeEnd.minus(periodMovement);

  const deltaByDay = new Map<string, Decimal>();
  for (const row of dailyDeltas) {
    const day = toIsoDay(row.date);
    const prev = deltaByDay.get(day) ?? new Decimal(0);
    deltaByDay.set(day, prev.plus(row._sum.amount?.toString() ?? "0"));
  }

  const dailyBalanceSeries: DailyBalancePoint[] = [];
  for (let cursor = new Date(range.from); cursor <= range.to; cursor = addDays(cursor, 1)) {
    const day = toIsoDay(cursor);
    carry = carry.plus(deltaByDay.get(day) ?? 0);
    const isFuture = cursor > today;
    dailyBalanceSeries.push({
      date: day,
      realized: isFuture ? null : carry.toDecimalPlaces(2).toNumber(),
      projected: carry.toDecimalPlaces(2).toNumber(),
    });
  }

  const netWorthSparkline = dailyBalanceSeries.map((point) => point.projected);

  // --- Despesas por categoria (bounded ao período) ---
  const periodTransactions = await prisma.transaction.findMany({
    where: {
      account: { isActive: true },
      date: { gte: range.from, lte: range.to },
      type: "EXPENSE",
    },
    select: { amount: true, categoryId: true, category: { select: { name: true, color: true } } },
  });

  const breakdownMap = new Map<string, { name: string; color: string; total: Decimal }>();
  for (const t of periodTransactions) {
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
    netWorthSparkline,
    income: income.toDecimalPlaces(2).toNumber(),
    expense: expense.toDecimalPlaces(2).toNumber(),
    savingsRatePct,
    dailyBurnRate,
    dailyBalanceSeries,
    categoryBreakdown,
    hasAnyTransaction: totalTransactionCount > 0,
  };
}
