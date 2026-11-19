import Decimal from "decimal.js";
import { prisma } from "@/lib/prisma";
import { computePositions } from "@/lib/investments/positions";

const dec = (v: { toString(): string }) => new Decimal(v.toString());

export interface PositionRow {
  ticker: string;
  quantity: number;
  averagePrice: number;
  totalCost: number;
  realizedSwing: number;
  realizedDayTrade: number;
  inconsistent: boolean;
}

export interface InvestmentTradeRow {
  id: string;
  tradeDate: string;
  side: "BUY" | "SELL";
  ticker: string;
  broker: string | null;
  quantity: number;
  price: number;
  grossAmount: number;
  fees: number;
  hasNote: boolean;
  source: "B3" | "Nota";
}

export interface PortfolioView {
  hasAny: boolean;
  positions: PositionRow[];
  recentTrades: InvestmentTradeRow[];
  totals: { openCost: number; realizedSwing: number; realizedDayTrade: number; fees: number; notes: number };
  /** Negócios ainda sem nota (custos zerados no preço médio). */
  tradesWithoutNote: number;
  lastImport: { provider: string; status: string; finishedAt: string | null; error: string | null } | null;
}

const RECENT = 100;

/** Carteira montada a partir de todos os negócios importados (escala pessoal: poucos milhares de linhas). */
export async function getPortfolio(): Promise<PortfolioView> {
  const [trades, notes, lastLog] = await Promise.all([
    prisma.investmentTrade.findMany({ orderBy: [{ tradeDate: "asc" }, { createdAt: "asc" }] }),
    prisma.brokerageNote.count(),
    prisma.syncLog.findFirst({
      where: { provider: { in: ["B3_XLSX", "BROKERAGE_NOTE_PDF"] } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const positions = computePositions(
    trades.map((t) => ({
      tradeDate: t.tradeDate.toISOString().slice(0, 10),
      side: t.side,
      ticker: t.ticker,
      quantity: t.quantity,
      price: dec(t.price),
      grossAmount: dec(t.grossAmount),
      fees: dec(t.fees),
    })),
  );

  const sum = (pick: (p: (typeof positions)[number]) => Decimal) =>
    positions.reduce((s, p) => s.plus(pick(p)), new Decimal(0)).toNumber();

  return {
    hasAny: trades.length > 0,
    positions: positions.map((p) => ({
      ticker: p.ticker,
      quantity: p.quantity,
      averagePrice: p.averagePrice.toDecimalPlaces(4).toNumber(),
      totalCost: p.totalCost.toDecimalPlaces(2).toNumber(),
      realizedSwing: p.realizedSwing.toDecimalPlaces(2).toNumber(),
      realizedDayTrade: p.realizedDayTrade.toDecimalPlaces(2).toNumber(),
      inconsistent: p.inconsistent,
    })),
    recentTrades: trades
      .slice(-RECENT)
      .reverse()
      .map((t) => ({
        id: t.id,
        tradeDate: t.tradeDate.toISOString().slice(0, 10),
        side: t.side,
        ticker: t.ticker,
        broker: t.broker,
        quantity: t.quantity,
        price: dec(t.price).toNumber(),
        grossAmount: dec(t.grossAmount).toNumber(),
        fees: dec(t.fees).toNumber(),
        hasNote: t.brokerageNoteId !== null,
        source: t.source === "B3_XLSX" ? "B3" : "Nota",
      })),
    totals: {
      openCost: sum((p) => p.totalCost),
      realizedSwing: sum((p) => p.realizedSwing),
      realizedDayTrade: sum((p) => p.realizedDayTrade),
      fees: trades.reduce((s, t) => s.plus(dec(t.fees)), new Decimal(0)).toNumber(),
      notes,
    },
    tradesWithoutNote: trades.filter((t) => t.brokerageNoteId === null).length,
    lastImport: lastLog
      ? {
          provider: lastLog.provider === "B3_XLSX" ? "planilha da B3" : "nota de corretagem",
          status: lastLog.status,
          finishedAt: lastLog.finishedAt?.toISOString() ?? null,
          error: lastLog.errorDetails,
        }
      : null,
  };
}
