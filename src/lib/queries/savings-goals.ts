import Decimal from "decimal.js";
import { prisma } from "@/lib/prisma";
import { toDecimal } from "@/lib/money";

export interface SavingsGoalView {
  id: string;
  name: string;
  targetAmount: number;
  targetDate: string;
  accountName: string;
  /** Saldo atual da conta de destino (progresso da meta). */
  currentAmount: number;
  progressPct: number;
  /** Ritmo necessário: quanto falta / meses restantes até o prazo. */
  monthlyNeeded: number | null;
}

/** Metas de poupança com progresso calculado a partir do saldo da conta. */
export async function getSavingsGoalViews(): Promise<SavingsGoalView[]> {
  const goals = await prisma.savingsGoal.findMany({
    include: { account: { select: { name: true, currentBalance: true } } },
    orderBy: { targetDate: "asc" },
  });

  const now = new Date();

  return goals.map((goal) => {
    const target = toDecimal(goal.targetAmount.toString());
    const current = Decimal.max(0, toDecimal(goal.account.currentBalance.toString()));
    const progressPct = target.isZero() ? 0 : current.dividedBy(target).toNumber();

    const monthsLeft = Math.max(
      0,
      (goal.targetDate.getUTCFullYear() - now.getUTCFullYear()) * 12 +
        (goal.targetDate.getUTCMonth() - now.getUTCMonth()),
    );
    const remaining = Decimal.max(0, target.minus(current));
    const monthlyNeeded = monthsLeft > 0 ? remaining.dividedBy(monthsLeft).toNumber() : null;

    return {
      id: goal.id,
      name: goal.name,
      targetAmount: target.toNumber(),
      targetDate: goal.targetDate.toISOString(),
      accountName: goal.account.name,
      currentAmount: current.toNumber(),
      progressPct,
      monthlyNeeded,
    };
  });
}
