import Decimal from "decimal.js";
import { prisma } from "@/lib/prisma";
import { presentValue } from "@/lib/financial-engine/debt-payoff";
import { SURPLUS_WINDOW, dateOfMonthIndex, monthIndexOf } from "@/lib/financial-engine/savings-goal";
import { EXPENSIVE_DEBT_RATE_PCT } from "@/lib/insights/allocator";
import { TRADING_WINDOW_DAYS, type BridgeInput } from "@/lib/insights/bridges";
import { getRecurringData } from "@/lib/queries/recurring";
import type { FinancialSnapshot } from "@/lib/queries/snapshot";

const DAY_MS = 86_400_000;
const num = (v: { toString(): string } | null | undefined) => (v ? new Decimal(v.toString()).toNumber() : 0);

/**
 * Dados das pontes entre telas (cartão, recorrentes, trading, corretora),
 * montados só para o painel Próximos passos. Reaproveita o retrato do mês
 * para sobra, reserva e custo essencial.
 */
export async function getBridgeInput(snapshot: FinancialSnapshot, now = new Date()): Promise<BridgeInput> {
  const currentMonth = monthIndexOf(now);
  const windowStart = dateOfMonthIndex(currentMonth - SURPLUS_WINDOW);
  const windowEnd = dateOfMonthIndex(currentMonth);
  const tradingFrom = new Date(now.getTime() - TRADING_WINDOW_DAYS * DAY_MS);

  const [overdue, recurring, income, debts, investments, tradeAgg, limits] = await Promise.all([
    prisma.creditCardInvoice.findMany({
      where: { status: { not: "PAID" }, dueDate: { lt: now }, account: { isActive: true } },
      select: { totalAmount: true },
    }),
    getRecurringData(now),
    prisma.transaction.aggregate({
      where: { account: { isActive: true }, type: "INCOME", date: { gte: windowStart, lt: windowEnd } },
      _sum: { amount: true },
    }),
    prisma.debt.findMany({ select: { installment: true, remaining: true, monthlyRatePct: true } }),
    prisma.account.aggregate({
      where: { isActive: true, type: "INVESTMENT" },
      _sum: { currentBalance: true },
    }),
    prisma.tradeEntry.aggregate({
      where: { mode: "REAL", resultBrl: { not: null }, date: { gte: tradingFrom } },
      _sum: { resultBrl: true },
      _count: { _all: true },
    }),
    prisma.tradeLimits.findUnique({ where: { id: 1 } }),
  ]);

  const overdueTotal = overdue.reduce((acc, i) => acc + Math.abs(num(i.totalAmount)), 0);

  const monthsUsed = snapshot.goals.surplus?.monthLabels.length ?? 0;
  const avgIncome = monthsUsed > 0 ? num(income._sum.amount) / monthsUsed : null;

  const expensive = debts.filter((r) => Number(r.monthlyRatePct) > EXPENSIVE_DEBT_RATE_PCT);
  const expensiveDebt = expensive.length
    ? {
        maxRatePct: Math.max(...expensive.map((r) => Number(r.monthlyRatePct))),
        balance: expensive
          .reduce(
            (acc, r) =>
              acc.plus(
                presentValue({
                  installment: new Decimal(r.installment.toString()),
                  remaining: r.remaining,
                  monthlyRate: new Decimal(r.monthlyRatePct.toString()).div(100),
                }),
              ),
            new Decimal(0),
          )
          .toNumber(),
      }
    : null;

  const maxLossMonth = limits?.maxLossMonth ? num(limits.maxLossMonth) : null;
  const trading =
    tradeAgg._count._all > 0 || maxLossMonth !== null
      ? { closed: tradeAgg._count._all, net: num(tradeAgg._sum.resultBrl), maxLossMonth }
      : null;

  return {
    overdueInvoices: overdue.length ? { total: overdueTotal, count: overdue.length } : null,
    subscriptions: recurring.subscriptions.items.length
      ? {
          monthly: recurring.subscriptions.monthlyTotal,
          annual: recurring.subscriptions.annualTotal,
          top: [...recurring.subscriptions.items]
            .sort((a, b) => b.monthlyCost - a.monthlyCost)
            .map((i) => ({ name: i.name, monthly: i.monthlyCost })),
        }
      : null,
    avgIncome,
    expensiveDebt,
    trading,
    averageSurplus: snapshot.goals.surplus?.average ?? null,
    reserveBalance: snapshot.reserveBalance,
    investmentBalance: Math.max(num(investments._sum.currentBalance), 0),
    monthlyEssential: snapshot.monthlyEssential,
  };
}
