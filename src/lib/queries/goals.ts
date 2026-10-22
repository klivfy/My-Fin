import Decimal from "decimal.js";
import { prisma } from "@/lib/prisma";
import {
  CONTRIBUTION_SHARE,
  EMERGENCY_FUND_MONTHS,
  SURPLUS_WINDOW,
  dateOfMonthIndex,
  monthIndexOf,
  planGoal,
  suggestContribution,
  suggestEmergencyFund,
  summarizeSurplus,
  type GoalStatus,
  type MonthTotals,
} from "@/lib/financial-engine/savings-goal";

export interface GoalView {
  id: string;
  name: string;
  target: number;
  saved: number;
  remaining: number;
  progress: number;
  targetDate: string | null;
  accountId: string | null;
  accountName: string | null;
  status: GoalStatus;
  requiredMonthly: number | null;
  /** Data (ISO, dia 1) prevista para concluir no ritmo sugerido. */
  projectedDate: string | null;
  milestones: Array<{ fraction: number; amount: number; reached: boolean; projectedDate: string | null }>;
}

export interface GoalsData {
  surplus: {
    average: number;
    worst: number;
    monthLabels: string[];
    contribution: number;
    contributionShare: number;
  } | null;
  emergencyFund: { amount: number; basedOn: "NEED" | "TOTAL"; months: number } | null;
  goals: GoalView[];
  /** Contas que podem financiar uma meta (poupança/investimento ainda livres). */
  linkableAccounts: Array<{ id: string; name: string; linkedGoalId: string | null }>;
}

const monthLabel = (index: number) =>
  new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" }).format(dateOfMonthIndex(index));

export async function getGoalsData(now = new Date()): Promise<GoalsData> {
  const currentMonth = monthIndexOf(now);
  const windowStart = dateOfMonthIndex(currentMonth - SURPLUS_WINDOW);
  const windowEnd = dateOfMonthIndex(currentMonth);

  const [firstTx, transactions, goals, accounts] = await Promise.all([
    prisma.transaction.aggregate({
      where: { account: { isActive: true }, type: { in: ["INCOME", "EXPENSE"] } },
      _min: { date: true },
    }),
    prisma.transaction.findMany({
      where: {
        account: { isActive: true },
        type: { in: ["INCOME", "EXPENSE"] },
        date: { gte: windowStart, lt: windowEnd },
      },
      select: { date: true, amount: true, type: true, category: { select: { nature: true } } },
    }),
    prisma.savingsGoal.findMany({
      orderBy: { createdAt: "asc" },
      include: { account: { select: { name: true, currentBalance: true } } },
    }),
    prisma.account.findMany({
      where: { isActive: true, type: { in: ["SAVINGS", "INVESTMENT"] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, savingsGoal: { select: { id: true } } },
    }),
  ]);

  const byMonth = new Map<number, MonthTotals>();
  for (const t of transactions) {
    const month = monthIndexOf(t.date);
    const row = byMonth.get(month) ?? { month, income: new Decimal(0), expense: new Decimal(0), needExpense: new Decimal(0) };
    const amount = new Decimal(t.amount.toString());
    if (t.type === "INCOME") {
      row.income = row.income.plus(amount);
    } else {
      row.expense = row.expense.plus(amount.abs());
      if (t.category?.nature === "NEED") row.needExpense = row.needExpense.plus(amount.abs());
    }
    byMonth.set(month, row);
  }

  const firstDataMonth = firstTx._min.date ? monthIndexOf(firstTx._min.date) : undefined;
  const summary = summarizeSurplus([...byMonth.values()], now, firstDataMonth);
  const contribution = summary ? suggestContribution(summary.averageSurplus) : new Decimal(0);
  const emergency = summary ? suggestEmergencyFund(summary) : null;
  const isoMonth = (index: number | null) => (index === null ? null : dateOfMonthIndex(index).toISOString());

  return {
    surplus: summary && {
      average: summary.averageSurplus.toNumber(),
      worst: summary.worstSurplus.toNumber(),
      monthLabels: summary.months.map(monthLabel),
      contribution: contribution.toNumber(),
      contributionShare: CONTRIBUTION_SHARE,
    },
    emergencyFund: emergency && {
      amount: emergency.amount.toNumber(),
      basedOn: emergency.basedOn,
      months: EMERGENCY_FUND_MONTHS,
    },
    goals: goals.map((goal) => {
      const saved = goal.account
        ? new Decimal(goal.account.currentBalance.toString())
        : new Decimal(goal.savedAmount.toString());
      const plan = planGoal({
        target: new Decimal(goal.targetAmount.toString()),
        saved,
        contribution,
        targetDate: goal.targetDate,
        now,
      });
      return {
        id: goal.id,
        name: goal.name,
        target: Number(goal.targetAmount.toString()),
        saved: plan.saved.toNumber(),
        remaining: plan.remaining.toNumber(),
        progress: plan.progress,
        targetDate: goal.targetDate?.toISOString() ?? null,
        accountId: goal.accountId,
        accountName: goal.account?.name ?? null,
        status: plan.status,
        requiredMonthly: plan.requiredMonthly?.toNumber() ?? null,
        projectedDate: isoMonth(plan.projectedMonth),
        milestones: plan.milestones.map((ms) => ({
          fraction: ms.fraction,
          amount: ms.amount.toNumber(),
          reached: ms.reached,
          projectedDate: isoMonth(ms.projectedMonth),
        })),
      };
    }),
    linkableAccounts: accounts.map((a) => ({ id: a.id, name: a.name, linkedGoalId: a.savingsGoal?.id ?? null })),
  };
}
