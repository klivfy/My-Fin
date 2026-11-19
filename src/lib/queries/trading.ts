import Decimal from "decimal.js";
import type { TradeMode } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { PeriodRange } from "@/lib/period";
import {
  journalStats,
  riskSnapshot,
  todayInB3,
  type JournalStats,
  type RiskLimits,
  type RiskSnapshot,
} from "@/lib/trading/risk";

export type ModeFilter = "real" | "simulado";

export function resolveMode(value?: string): ModeFilter {
  return value === "simulado" ? "simulado" : "real";
}

const toMode = (m: ModeFilter): TradeMode => (m === "simulado" ? "SIMULADO" : "REAL");
const dec = (v: { toString(): string } | null) => (v === null ? null : new Decimal(v.toString()));
const day = (v: Date | null) => (v ? v.toISOString().slice(0, 10) : null);

export interface TradeRow {
  id: string;
  date: string;
  entryDate: string | null;
  ticker: string;
  style: string | null;
  setup: string | null;
  quantity: number;
  entryPrice: number | null;
  exitPrice: number | null;
  resultBrl: number | null;
  resultR: number | null;
  exitReason: string | null;
}

export interface JournalView {
  hasAny: boolean;
  counts: Record<ModeFilter, number>;
  rows: TradeRow[];
  stats: { closed: number; winRate: number | null; net: number; costs: number; expectancyR: number | null };
}

function plainStats(s: JournalStats): JournalView["stats"] {
  return {
    closed: s.closed,
    winRate: s.winRate,
    net: s.net.toNumber(),
    costs: s.costs.toNumber(),
    expectancyR: s.expectancyR?.toNumber() ?? null,
  };
}

export async function getJournal(range: PeriodRange, mode: ModeFilter): Promise<JournalView> {
  const [grouped, entries] = await Promise.all([
    prisma.tradeEntry.groupBy({ by: ["mode"], _count: { _all: true } }),
    prisma.tradeEntry.findMany({
      where: { mode: toMode(mode), date: { gte: range.from, lte: range.to } },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    }),
  ]);
  const counts = { real: 0, simulado: 0 };
  for (const g of grouped) counts[g.mode === "SIMULADO" ? "simulado" : "real"] = g._count._all;

  const stats = journalStats(
    entries.map((e) => ({ resultBrl: dec(e.resultBrl), resultR: dec(e.resultR), costs: dec(e.costs) })),
  );

  return {
    hasAny: counts.real + counts.simulado > 0,
    counts,
    stats: plainStats(stats),
    rows: entries.map((e) => ({
      id: e.id,
      date: day(e.date)!,
      entryDate: day(e.entryDate),
      ticker: e.ticker,
      style: e.style,
      setup: e.setup,
      quantity: e.quantity,
      entryPrice: e.entryPrice === null ? null : Number(e.entryPrice),
      exitPrice: e.exitPrice === null ? null : Number(e.exitPrice),
      resultBrl: e.resultBrl === null ? null : Number(e.resultBrl),
      resultR: e.resultR === null ? null : Number(e.resultR),
      exitReason: e.exitReason,
    })),
  };
}

export interface LimitsView {
  maxLossDay: number | null;
  maxLossMonth: number | null;
  pauseDaysAfterMonth: number | null;
  maxTradesDay: number | null;
}

async function loadLimits(): Promise<RiskLimits> {
  const row = await prisma.tradeLimits.findUnique({ where: { id: 1 } });
  return {
    maxLossDay: dec(row?.maxLossDay ?? null),
    maxLossMonth: dec(row?.maxLossMonth ?? null),
    pauseDaysAfterMonth: row?.pauseDaysAfterMonth ?? null,
    maxTradesDay: row?.maxTradesDay ?? null,
  };
}

export interface RiskView {
  mode: ModeFilter;
  hasAny: boolean;
  limits: LimitsView;
  snapshot: RiskSnapshot;
}

/** Estado de risco de hoje (fuso da B3), só do modo pedido: real e simulado não se misturam. */
export async function getRisk(mode: ModeFilter): Promise<RiskView> {
  const today = todayInB3();
  const [limits, entries, total] = await Promise.all([
    loadLimits(),
    // Mês corrente e o anterior bastam: a pausa mensal atravessa no máximo uma virada.
    prisma.tradeEntry.findMany({
      where: {
        mode: toMode(mode),
        date: { gte: new Date(`${previousMonthStart(today)}T00:00:00Z`) },
      },
      select: { date: true, entryDate: true, resultBrl: true },
    }),
    prisma.tradeEntry.count(),
  ]);
  return {
    mode,
    hasAny: total > 0,
    limits: {
      maxLossDay: limits.maxLossDay?.toNumber() ?? null,
      maxLossMonth: limits.maxLossMonth?.toNumber() ?? null,
      pauseDaysAfterMonth: limits.pauseDaysAfterMonth,
      maxTradesDay: limits.maxTradesDay,
    },
    snapshot: riskSnapshot(
      entries.map((e) => ({ date: day(e.date)!, entryDate: day(e.entryDate), resultBrl: dec(e.resultBrl) })),
      limits,
      today,
    ),
  };
}

function previousMonthStart(today: string): string {
  const [y, m] = today.split("-").map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, "0")}-01`;
}

export interface TradingHomeSummary {
  monthNet: number;
  monthClosed: number;
  entriesBlocked: boolean;
  limitsSet: boolean;
}

/** Resumo para a Visão geral (modo real). `null` se o diário nunca foi importado. */
export async function getTradingHomeSummary(): Promise<TradingHomeSummary | null> {
  const risk = await getRisk("real");
  if (!risk.hasAny) return null;
  const monthStart = `${risk.snapshot.today.slice(0, 7)}-01`;
  const monthClosed = await prisma.tradeEntry.count({
    where: { mode: "REAL", resultBrl: { not: null }, date: { gte: new Date(`${monthStart}T00:00:00Z`) } },
  });
  const l = risk.limits;
  return {
    monthNet: risk.snapshot.monthResult.toNumber(),
    monthClosed,
    entriesBlocked: risk.snapshot.entriesBlocked,
    limitsSet: [l.maxLossDay, l.maxLossMonth, l.maxTradesDay].some((v) => v !== null),
  };
}
