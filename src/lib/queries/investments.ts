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

export interface SourcesView {
  b3: { lastImportAt: string | null; lastInserted: number | null; failed: boolean };
  notes: { count: number; lastTradeDate: string | null; lastImportAt: string | null; failed: boolean };
  tradesWithoutNote: number;
  openFinanceConnections: number;
}

export interface PortfolioView {
  hasAny: boolean;
  positions: PositionRow[];
  recentTrades: InvestmentTradeRow[];
  totals: { openCost: number; realizedSwing: number; realizedDayTrade: number; fees: number; notes: number };
  sources: SourcesView;
}

const RECENT = 100;

/** Carteira montada a partir de todos os negócios importados (escala pessoal: poucos milhares de linhas). */
export async function getPortfolio(): Promise<PortfolioView> {
  const lastLog = (provider: "B3_XLSX" | "BROKERAGE_NOTE_PDF") =>
    prisma.syncLog.findFirst({ where: { provider }, orderBy: { createdAt: "desc" } });
  const [trades, notes, lastNote, b3Log, noteLog, connections] = await Promise.all([
    prisma.investmentTrade.findMany({ orderBy: [{ tradeDate: "asc" }, { createdAt: "asc" }] }),
    prisma.brokerageNote.count(),
    prisma.brokerageNote.findFirst({ orderBy: { tradeDate: "desc" }, select: { tradeDate: true } }),
    lastLog("B3_XLSX"),
    lastLog("BROKERAGE_NOTE_PDF"),
    prisma.investmentConnection.count({ where: { status: "ACTIVE" } }),
  ]);
  const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

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
    sources: {
      b3: {
        lastImportAt: iso(b3Log?.finishedAt),
        lastInserted: b3Log?.status === "SUCCESS" ? b3Log.recordsInserted : null,
        failed: b3Log?.status === "FAILED",
      },
      notes: {
        count: notes,
        lastTradeDate: lastNote ? lastNote.tradeDate.toISOString().slice(0, 10) : null,
        lastImportAt: iso(noteLog?.finishedAt),
        failed: noteLog?.status === "FAILED",
      },
      tradesWithoutNote: trades.filter((t) => t.brokerageNoteId === null).length,
      openFinanceConnections: connections,
    },
  };
}
