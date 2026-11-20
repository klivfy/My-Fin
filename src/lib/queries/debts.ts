import Decimal from "decimal.js";
import type { Debt } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getGoalsData } from "@/lib/queries/goals";
import {
  comparePayoff,
  presentValue,
  type DebtInput,
  type PayoffPlan,
  type Strategy,
} from "@/lib/financial-engine/debt-payoff";

export type ChosenStrategy = Exclude<Strategy, "parcelas">;

export function resolveStrategy(value?: string): ChosenStrategy | null {
  return value === "avalanche" || value === "bola-de-neve" ? value : null;
}

/** "100", "100,50" ou vazio. Negativo, inválido ou absurdo vira 0. */
export function resolveExtra(value?: string): number {
  if (!value) return 0;
  const n = Number(value.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 && n < 1_000_000 ? Math.round(n * 100) / 100 : 0;
}

export interface DebtView {
  id: string;
  name: string;
  installment: number;
  remaining: number;
  monthlyRatePct: number;
  /** Valor presente das parcelas que faltam (saldo para quitar hoje, estimado). */
  balanceToday: number;
  updatedAt: string;
}

export interface PlanView {
  months: number;
  totalPaid: number;
  interest: number;
  /** Data (1º dia do mês) em que fica livre. */
  freeOn: string;
  payoffMonth: Record<string, number>;
  order: string[];
  schedule: Array<{ month: number; date: string; payments: number[]; total: number; paidOff: string[] }>;
}

export interface DebtsData {
  debts: DebtView[];
  extra: number;
  /** Sugestão de extra pela sobra real (mesma regra das metas de poupança); null sem histórico. */
  surplusContribution: number | null;
  monthlyBudget: number;
  comparison: {
    balanceToday: number;
    contract: PlanView;
    snowball: PlanView;
    avalanche: PlanView;
    cheaper: "bola-de-neve" | "avalanche" | "empate";
    difference: number;
    secondWin: { snowball: number | null; avalanche: number | null };
  } | null;
}

function toInput(r: Debt): DebtInput {
  return {
    id: r.id,
    name: r.name,
    installment: new Decimal(r.installment.toString()),
    remaining: r.remaining,
    monthlyRate: new Decimal(r.monthlyRatePct.toString()).div(100),
  };
}

/** Mês 1 = mês que vem (a parcela deste mês é tratada como já paga ou a pagar fora do plano). */
function monthDate(now: Date, month: number): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + month, 1)).toISOString();
}

function planView(plan: PayoffPlan, now: Date): PlanView {
  return {
    months: plan.months,
    totalPaid: plan.totalPaid.toNumber(),
    interest: plan.interest.toNumber(),
    freeOn: monthDate(now, plan.months),
    payoffMonth: plan.payoffMonth,
    order: plan.order,
    schedule: plan.schedule.map((r) => ({
      month: r.month,
      date: monthDate(now, r.month),
      payments: r.payments.map((p) => p.toNumber()),
      total: r.total.toNumber(),
      paidOff: r.paidOff,
    })),
  };
}

export async function getDebtsData(extra: number, now = new Date()): Promise<DebtsData> {
  const [rows, goals] = await Promise.all([
    prisma.debt.findMany({ orderBy: { createdAt: "asc" } }),
    getGoalsData(now),
  ]);

  const inputs = rows.map(toInput);

  const debts: DebtView[] = rows.map((r, i) => ({
    id: r.id,
    name: r.name,
    installment: inputs[i].installment.toNumber(),
    remaining: r.remaining,
    monthlyRatePct: Number(r.monthlyRatePct),
    balanceToday: presentValue(inputs[i]).toNumber(),
    updatedAt: r.updatedAt.toISOString(),
  }));

  const c = inputs.length ? comparePayoff(inputs, new Decimal(extra)) : null;

  return {
    debts,
    extra,
    surplusContribution: goals.surplus && goals.surplus.contribution > 0 ? goals.surplus.contribution : null,
    monthlyBudget: debts.reduce((a, d) => a + d.installment, 0) + extra,
    comparison: c && {
      balanceToday: c.balanceToday.toNumber(),
      contract: planView(c.contract, now),
      snowball: planView(c.snowball, now),
      avalanche: planView(c.avalanche, now),
      cheaper: c.cheaper,
      difference: c.difference.toNumber(),
      secondWin: c.secondWin,
    },
  };
}

export interface DebtHomeSummary {
  count: number;
  balanceToday: number;
  monthlyInstallments: number;
  /** Livre em (só as parcelas). */
  contractFreeOn: string;
  /** Livre em, rolando as parcelas pelo método mais barato, sem dinheiro novo. */
  rolledFreeOn: string;
  monthsSaved: number;
}

/** Resumo para a Visão geral; null sem dívidas cadastradas. */
export async function getDebtHomeSummary(now = new Date()): Promise<DebtHomeSummary | null> {
  const rows = await prisma.debt.findMany();
  if (rows.length === 0) return null;
  const inputs = rows.map(toInput);
  const c = comparePayoff(inputs);
  const best = c.cheaper === "bola-de-neve" ? c.snowball : c.avalanche;
  return {
    count: rows.length,
    balanceToday: c.balanceToday.toNumber(),
    monthlyInstallments: inputs.reduce((a, d) => a + d.installment.toNumber(), 0),
    contractFreeOn: monthDate(now, c.contract.months),
    rolledFreeOn: monthDate(now, best.months),
    monthsSaved: c.contract.months - best.months,
  };
}
