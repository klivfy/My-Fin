import Decimal from "decimal.js";
import type { Prisma, SyncProvider } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  normalizeTicker,
  type NormalizedTrade,
} from "@/lib/investments/common";

/** Persistência compartilhada pelas importações de negócios (B3, notas, Pluggy). */

export interface ImportResult {
  read: number;
  inserted: number;
  /** Negócios que já existiam vindos de outra fonte e foram completados. */
  matched: number;
  skipped: number;
}

/** Abre um SyncLog, roda a importação e fecha o log com sucesso ou falha. */
export async function withSyncLog(
  provider: SyncProvider,
  fn: (syncLogId: string) => Promise<ImportResult>,
): Promise<ImportResult> {
  const log = await prisma.syncLog.create({
    data: { provider, status: "RUNNING" },
  });
  try {
    const result = await fn(log.id);
    await prisma.syncLog.update({
      where: { id: log.id },
      data: {
        status: "SUCCESS",
        recordsProcessed: result.read,
        recordsInserted: result.inserted,
        recordsSkipped: result.skipped,
        finishedAt: new Date(),
      },
    });
    return result;
  } catch (error) {
    await prisma.syncLog.update({
      where: { id: log.id },
      data: {
        status: "FAILED",
        errorDetails: error instanceof Error ? error.message : String(error),
        finishedAt: new Date(),
      },
    });
    throw error;
  }
}

export const asDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
export const isoOf = (d: Date) => d.toISOString().slice(0, 10);

/** Negócios gravados nas datas informadas, no formato do pareamento. */
export async function storedTrades(
  tx: Prisma.TransactionClient,
  dates: string[],
  where: Prisma.InvestmentTradeWhereInput,
) {
  const rows = await tx.investmentTrade.findMany({
    where: { ...where, tradeDate: { in: [...new Set(dates)].map(asDate) } },
    select: {
      id: true,
      tradeDate: true,
      side: true,
      ticker: true,
      quantity: true,
      price: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    tradeDate: isoOf(r.tradeDate),
    side: r.side,
    ticker: r.ticker,
    tickerKnown: normalizeTicker(r.ticker) !== null,
    quantity: r.quantity,
    price: new Decimal(r.price.toString()),
  }));
}

export function tradeData(
  t: NormalizedTrade & { matchKey: string },
  source: SyncProvider,
  syncLogId: string,
) {
  return {
    tradeDate: asDate(t.tradeDate),
    side: t.side,
    ticker: t.ticker,
    market: t.market,
    broker: t.broker,
    quantity: t.quantity,
    price: t.price.toFixed(4),
    grossAmount: t.grossAmount.toFixed(2),
    source,
    matchKey: t.matchKey,
    syncLogId,
  };
}
