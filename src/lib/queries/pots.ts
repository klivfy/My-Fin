import Decimal from "decimal.js";
import { prisma } from "@/lib/prisma";
import type { PeriodRange } from "@/lib/period";
import {
  POT_ORDER,
  POTS,
  computePots,
  defaultPercents,
  resolvePot,
  splitAmount,
  type Percents,
  type Pot,
  type PotKind,
} from "@/lib/financial-engine/pots";

/** Contas onde o dinheiro guardado fica. Transferir para elas é aportar. */
const SAVING_ACCOUNT_TYPES = ["SAVINGS", "INVESTMENT"] as const;
const TRANSFER_ROW_NAME = "Aportes por transferência";

export interface PotLineView {
  pot: Pot;
  label: string;
  hint: string;
  kind: PotKind;
  percent: number;
  target: number;
  used: number;
  usedShare: number | null;
  remaining: number;
  attention: boolean;
  /** Categorias do pote com movimento no período, maior primeiro. */
  categories: Array<{ name: string; spent: number }>;
}

export interface PotsView {
  periodLabel: string;
  income: number;
  lines: PotLineView[];
  unassigned: number;
  /** Divisão de uma entrada avulsa (?entrada=), quando pedida. */
  split: { amount: number; parts: Array<{ pot: Pot; label: string; value: number }> } | null;
  /** Há categorias de despesa que nunca foram colocadas em pote nem têm natureza. */
  hasUnassignedCategories: boolean;
}

/** "3000", "3.000,50" ou vazio. Inválido, negativo ou absurdo vira null. */
export function resolveEntrada(value?: string): number | null {
  if (!value) return null;
  const n = Number(value.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 && n < 100_000_000 ? Math.round(n * 100) / 100 : null;
}

export async function getPercents(): Promise<Percents> {
  const rows = await prisma.potAllocation.findMany();
  const percents = defaultPercents();
  // Só vale o conjunto completo e consistente; linha solta isolada não mexe no padrão.
  if (rows.length === POT_ORDER.length) {
    for (const r of rows) percents[r.pot as Pot] = new Decimal(r.percent.toString());
  }
  return percents;
}

/**
 * Visão por potes do período: mesmo recorte do Dashboard e da regra 50/30/20
 * (contas ativas, só INCOME/EXPENSE; transferências e ajustes não contam).
 */
export async function getPotsView(range: PeriodRange, entrada: number | null): Promise<PotsView> {
  const [percents, transactions, expenseCategories, savedTransfers] = await Promise.all([
    getPercents(),
    prisma.transaction.findMany({
      where: {
        account: { isActive: true },
        date: { gte: range.from, lte: range.to },
        type: { in: ["INCOME", "EXPENSE"] },
      },
      select: {
        amount: true,
        type: true,
        category: { select: { name: true, nature: true, pot: true } },
      },
    }),
    prisma.category.findMany({
      where: { type: "EXPENSE" },
      select: { nature: true, pot: true },
    }),
    // Aporte por transferência (conta corrente para poupança ou corretora) também é dinheiro guardado.
    prisma.transfer.aggregate({
      where: {
        date: { gte: range.from, lte: range.to },
        destinationAccount: { isActive: true, type: { in: [...SAVING_ACCOUNT_TYPES] } },
        sourceAccount: { isActive: true, type: { notIn: [...SAVING_ACCOUNT_TYPES] } },
      },
      _sum: { amount: true },
    }),
  ]);

  let income = new Decimal(0);
  const spendByKey = new Map<string, { pot: Pot | null; name: string; spent: Decimal }>();
  for (const t of transactions) {
    const amount = new Decimal(t.amount.toString());
    if (t.type === "INCOME") {
      income = income.plus(amount);
      continue;
    }
    const pot = resolvePot(t.category?.nature ?? null, (t.category?.pot as Pot | null) ?? null);
    const name = t.category?.name ?? "Sem categoria";
    const key = `${pot ?? "none"}:${name}`;
    const row = spendByKey.get(key) ?? { pot, name, spent: new Decimal(0) };
    row.spent = row.spent.plus(amount.abs());
    spendByKey.set(key, row);
  }

  const transferred = new Decimal(savedTransfers._sum.amount?.toString() ?? "0");
  if (transferred.gt(0)) {
    spendByKey.set(`LIBERDADE:${TRANSFER_ROW_NAME}`, { pot: "LIBERDADE", name: TRANSFER_ROW_NAME, spent: transferred });
  }

  const rows = [...spendByKey.values()];
  const result = computePots(income, rows, percents);

  const lines: PotLineView[] = result.lines.map((l) => ({
    pot: l.pot,
    label: POTS[l.pot].label,
    hint: POTS[l.pot].hint,
    kind: POTS[l.pot].kind,
    percent: l.percent.toNumber(),
    target: l.target.toNumber(),
    used: l.used.toNumber(),
    usedShare: l.usedShare,
    remaining: l.remaining.toNumber(),
    attention: l.attention,
    categories: rows
      .filter((r) => r.pot === l.pot && r.spent.gt(0))
      .sort((a, b) => b.spent.comparedTo(a.spent))
      .map((r) => ({ name: r.name, spent: r.spent.toNumber() })),
  }));

  const parts = entrada ? splitAmount(new Decimal(entrada), percents) : null;

  return {
    periodLabel: range.label,
    income: income.toNumber(),
    lines,
    unassigned: result.unassigned.toNumber(),
    split: parts && {
      amount: entrada!,
      parts: POT_ORDER.map((pot) => ({ pot, label: POTS[pot].label, value: parts[pot].toNumber() })),
    },
    hasUnassignedCategories: expenseCategories.some((c) => resolvePot(c.nature, (c.pot as Pot | null) ?? null) === null),
  };
}
