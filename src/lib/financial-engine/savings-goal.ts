import Decimal from "decimal.js";

/**
 * Metas de poupança dimensionadas pela sobra REAL do usuário (receitas −
 * despesas dos últimos meses completos), não por um percentual idealizado.
 */

export interface MonthTotals {
  /** Índice do mês: ano * 12 + mês (0-based). */
  month: number;
  income: Decimal;
  /** Despesas do mês, positivas. */
  expense: Decimal;
  /** Despesas em categorias de Necessidade, positivas. */
  needExpense: Decimal;
}

export interface SurplusSummary {
  /** Meses usados no cálculo (do mais antigo ao mais recente). */
  months: number[];
  averageSurplus: Decimal;
  worstSurplus: Decimal;
  averageExpense: Decimal;
  averageNeedExpense: Decimal;
}

/** Quantos meses completos entram na média. */
export const SURPLUS_WINDOW = 3;
/** Fração da sobra sugerida como aporte: o resto é folga para meses ruins. */
export const CONTRIBUTION_SHARE = 0.8;
/** Reserva de emergência: meses de custo essencial. */
export const EMERGENCY_FUND_MONTHS = 6;
export const MILESTONES = [0.25, 0.5, 0.75, 1] as const;

export function monthIndexOf(date: Date): number {
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
}

export function dateOfMonthIndex(index: number, day = 1): Date {
  return new Date(Date.UTC(Math.floor(index / 12), index % 12, day));
}

function average(values: Decimal[]): Decimal {
  return values.reduce((s, v) => s.plus(v), new Decimal(0)).dividedBy(values.length).toDecimalPlaces(2);
}

/**
 * Média da sobra nos últimos `SURPLUS_WINDOW` meses COMPLETOS. Ficam de
 * fora o mês corrente (ainda em andamento) e o primeiro mês com dados (o
 * extrato quase sempre começa no meio dele — salário ausente distorce
 * tudo). Retorna null sem nenhum mês aproveitável.
 */
export function summarizeSurplus(
  totals: MonthTotals[],
  now: Date,
  /** Primeiro mês com dados em TODO o histórico (default: o menor de `totals`). */
  firstDataMonth?: number,
): SurplusSummary | null {
  if (totals.length === 0) return null;
  const firstMonth = firstDataMonth ?? Math.min(...totals.map((t) => t.month));
  const currentMonth = monthIndexOf(now);

  const usable = totals
    .filter((t) => t.month > firstMonth && t.month < currentMonth)
    .sort((a, b) => a.month - b.month)
    .slice(-SURPLUS_WINDOW);
  if (usable.length === 0) return null;

  const surpluses = usable.map((t) => t.income.minus(t.expense));
  return {
    months: usable.map((t) => t.month),
    averageSurplus: average(surpluses),
    worstSurplus: Decimal.min(...surpluses),
    averageExpense: average(usable.map((t) => t.expense)),
    averageNeedExpense: average(usable.map((t) => t.needExpense)),
  };
}

/**
 * Reserva de emergência sugerida: `EMERGENCY_FUND_MONTHS` × o custo mensal
 * de Necessidades. Sem naturezas definidas, usa o gasto total (mais
 * conservador) e sinaliza com `basedOn: "TOTAL"`.
 */
export function suggestEmergencyFund(summary: SurplusSummary): { amount: Decimal; basedOn: "NEED" | "TOTAL" } {
  const useNeeds = summary.averageNeedExpense.gt(0);
  const monthly = useNeeds ? summary.averageNeedExpense : summary.averageExpense;
  // Arredonda para cima em centenas: meta "redonda" é mais fácil de lembrar.
  const amount = monthly.times(EMERGENCY_FUND_MONTHS).dividedBy(100).ceil().times(100);
  return { amount, basedOn: useNeeds ? "NEED" : "TOTAL" };
}

/** Aporte mensal sugerido: `CONTRIBUTION_SHARE` da sobra média, arredondado para baixo em R$ 10. */
export function suggestContribution(averageSurplus: Decimal): Decimal {
  if (!averageSurplus.gt(0)) return new Decimal(0);
  return averageSurplus.times(CONTRIBUTION_SHARE).dividedBy(10).floor().times(10);
}

export interface Milestone {
  fraction: number;
  amount: Decimal;
  reached: boolean;
  /** Mês previsto para atingir (índice), se ainda não atingido e houver aporte. */
  projectedMonth: number | null;
}

export type GoalStatus = "DONE" | "ON_TRACK" | "AT_RISK" | "NO_SURPLUS" | "NO_DEADLINE";

export interface GoalPlan {
  saved: Decimal;
  remaining: Decimal;
  progress: number;
  contribution: Decimal;
  /** Meses para concluir no ritmo sugerido; null se não há aporte possível. */
  monthsToGoal: number | null;
  projectedMonth: number | null;
  milestones: Milestone[];
  status: GoalStatus;
  /** Com data-alvo: aporte mensal necessário para cumpri-la. */
  requiredMonthly: Decimal | null;
}

/**
 * Plano de uma meta: progresso, marcos de 25/50/75/100% com mês previsto
 * no ritmo do aporte sugerido e, com data-alvo, se ela cabe na sobra.
 * O primeiro aporte conta no mês seguinte a `now`.
 */
export function planGoal(input: {
  target: Decimal;
  saved: Decimal;
  contribution: Decimal;
  targetDate: Date | null;
  now: Date;
}): GoalPlan {
  const saved = Decimal.max(input.saved, 0);
  const remaining = Decimal.max(input.target.minus(saved), 0);
  const progress = input.target.gt(0) ? Math.min(1, saved.dividedBy(input.target).toNumber()) : 0;
  const currentMonth = monthIndexOf(input.now);
  const canContribute = input.contribution.gt(0);

  const monthsUntil = (amount: Decimal): number | null => {
    const missing = amount.minus(saved);
    if (!missing.gt(0)) return 0;
    return canContribute ? missing.dividedBy(input.contribution).ceil().toNumber() : null;
  };

  const milestones: Milestone[] = MILESTONES.map((fraction) => {
    const amount = input.target.times(fraction).toDecimalPlaces(2);
    const reached = saved.gte(amount);
    const months = reached ? null : monthsUntil(amount);
    return { fraction, amount, reached, projectedMonth: months === null ? null : currentMonth + months };
  });

  const monthsToGoal = monthsUntil(input.target);
  const projectedMonth = monthsToGoal === null ? null : currentMonth + monthsToGoal;

  let requiredMonthly: Decimal | null = null;
  let status: GoalStatus;
  if (remaining.isZero()) {
    status = "DONE";
  } else if (input.targetDate) {
    const monthsLeft = Math.max(1, monthIndexOf(input.targetDate) - currentMonth);
    requiredMonthly = remaining.dividedBy(monthsLeft).toDecimalPlaces(2, Decimal.ROUND_UP);
    status = input.contribution.gte(requiredMonthly) ? "ON_TRACK" : canContribute ? "AT_RISK" : "NO_SURPLUS";
  } else {
    status = canContribute ? "NO_DEADLINE" : "NO_SURPLUS";
  }

  return { saved, remaining, progress, contribution: input.contribution, monthsToGoal, projectedMonth, milestones, status, requiredMonthly };
}
