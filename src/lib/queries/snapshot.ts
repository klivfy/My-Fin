import Decimal from "decimal.js";
import { prisma } from "@/lib/prisma";
import { getGoalsData, type GoalsData } from "@/lib/queries/goals";
import { presentValue } from "@/lib/financial-engine/debt-payoff";
import {
  EMERGENCY_FUND_MONTHS,
  SURPLUS_WINDOW,
  dateOfMonthIndex,
  monthIndexOf,
} from "@/lib/financial-engine/savings-goal";
import { allocateSurplus, type Allocation } from "@/lib/insights/allocator";

/**
 * Retrato financeiro do mês, montado uma vez por requisição e lido por todas
 * as telas que sugerem algo (Visão geral, Metas, Dívidas). Antes, cada tela
 * refazia o próprio recorte e a mesma sobra era sugerida a Metas e Dívidas ao
 * mesmo tempo. Mesmo recorte do Dashboard: contas ativas, só receitas e
 * despesas, transferências à parte.
 */
export interface FinancialSnapshot {
  hasTransactions: boolean;
  /** Metas e sobra real (média dos últimos meses completos). */
  goals: GoalsData;
  /** Fração do gasto dos meses usados que tem categoria; null sem gasto. */
  categorizedShare: number | null;
  /** Saldo em contas de poupança: o que já funciona como reserva. */
  reserveBalance: number;
  /** Custo mensal essencial; null sem meses completos. */
  monthlyEssential: number | null;
  /** Fila única da sobra; null sem meses completos ou sem sobra. */
  allocation: Allocation | null;
}

export async function getFinancialSnapshot(now = new Date()): Promise<FinancialSnapshot> {
  const currentMonth = monthIndexOf(now);
  const windowStart = dateOfMonthIndex(currentMonth - SURPLUS_WINDOW);
  const windowEnd = dateOfMonthIndex(currentMonth);
  const expenseWindow = {
    account: { isActive: true },
    type: "EXPENSE" as const,
    date: { gte: windowStart, lt: windowEnd },
  };

  const [goals, txCount, spentAll, spentUncategorized, savingsAccounts, debts] = await Promise.all([
    getGoalsData(now),
    prisma.transaction.count({ where: { account: { isActive: true }, type: { in: ["INCOME", "EXPENSE"] } } }),
    prisma.transaction.aggregate({ where: expenseWindow, _sum: { amount: true } }),
    prisma.transaction.aggregate({ where: { ...expenseWindow, categoryId: null }, _sum: { amount: true } }),
    prisma.account.findMany({
      where: { isActive: true, type: "SAVINGS" },
      select: { id: true, currentBalance: true },
    }),
    prisma.debt.findMany({ orderBy: { createdAt: "asc" } }),
  ]);

  const total = new Decimal(spentAll._sum.amount?.toString() ?? "0").abs();
  const uncategorized = new Decimal(spentUncategorized._sum.amount?.toString() ?? "0").abs();
  const categorizedShare = total.gt(0) ? total.minus(uncategorized).div(total).toNumber() : null;

  const reserveBalance = savingsAccounts.reduce((acc, a) => acc.plus(a.currentBalance.toString()), new Decimal(0));
  const monthlyEssential = goals.emergencyFund ? new Decimal(goals.emergencyFund.amount).div(EMERGENCY_FUND_MONTHS) : null;

  // Meta ligada a conta de poupança já está contada na reserva: não entra de novo como meta.
  const savingsIds = new Set(savingsAccounts.map((a) => a.id));
  const goalsToFund = goals.goals
    .filter((g) => (g.accountId === null || !savingsIds.has(g.accountId)) && g.remaining > 0)
    .map((g) => ({ id: g.id, name: g.name, remaining: new Decimal(g.remaining) }));

  const contribution = goals.surplus?.contribution ?? 0;
  const allocation =
    monthlyEssential && contribution > 0
      ? allocateSurplus({
          pool: new Decimal(contribution),
          monthlyEssential,
          reserveBalance,
          debts: debts.map((r) => ({
            id: r.id,
            name: r.name,
            monthlyRatePct: Number(r.monthlyRatePct),
            balance: presentValue({
              installment: new Decimal(r.installment.toString()),
              remaining: r.remaining,
              monthlyRate: new Decimal(r.monthlyRatePct.toString()).div(100),
            }),
          })),
          goals: goalsToFund,
        })
      : null;

  return {
    hasTransactions: txCount > 0,
    goals,
    categorizedShare,
    reserveBalance: reserveBalance.toNumber(),
    monthlyEssential: monthlyEssential?.toNumber() ?? null,
    allocation,
  };
}
