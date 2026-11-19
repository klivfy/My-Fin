import Decimal from "decimal.js";
import {
  normalizeTicker,
  type NormalizedTrade,
} from "@/lib/investments/common";
import type {
  PluggyInvestment,
  PluggyInvestmentTransaction,
} from "@/lib/investments/pluggy-client";

/** Tipos negociados em bolsa que viram negócio com preço médio (ações, FIIs, BDRs, ETFs). */
export const TRADED_TYPES = new Set(["EQUITY", "ETF"]);
/** IR retido não é custo do negócio: não entra no preço médio. */
const NOT_A_COST = new Set(["incomeTax", "iofProvision"]);

export type PluggyTrade = NormalizedTrade & { fees: Decimal };

export interface MappedTrades {
  trades: PluggyTrade[];
  /** Movimentos que não são compra ou venda à vista de ativo de bolsa. */
  ignored: number;
}

function sumExpenses(
  expenses: PluggyInvestmentTransaction["expenses"],
): Decimal {
  let total = new Decimal(0);
  for (const [k, v] of Object.entries(expenses ?? {})) {
    if (!NOT_A_COST.has(k) && typeof v === "number" && Number.isFinite(v))
      total = total.plus(Math.abs(v));
  }
  return total.toDecimalPlaces(2);
}

/**
 * Converte movimentos do Pluggy em negócios normalizados. Só compra e venda
 * de ações, FIIs, BDRs e ETFs, com quantidade inteira; o resto é contado em
 * `ignored` para a tela dizer quanto ficou de fora.
 */
export function mapPluggyTrades(
  rows: Array<{
    investment: PluggyInvestment;
    transactions: PluggyInvestmentTransaction[];
  }>,
  fallbackBroker: string | null,
): MappedTrades {
  const trades: PluggyTrade[] = [];
  let ignored = 0;
  for (const { investment, transactions } of rows) {
    if (!TRADED_TYPES.has(investment.type)) {
      ignored += transactions.length;
      continue;
    }
    const known = normalizeTicker(investment.code ?? "");
    const ticker =
      known ?? (investment.code || investment.name).trim().toUpperCase();
    const broker = investment.institution?.name?.trim() || fallbackBroker;
    for (const t of transactions) {
      const side = t.type === "BUY" ? "BUY" : t.type === "SELL" ? "SELL" : null;
      const quantity = Math.abs(t.quantity ?? 0);
      const day = (t.tradeDate ?? t.date ?? "").slice(0, 10);
      if (
        !side ||
        !Number.isInteger(quantity) ||
        quantity === 0 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(day)
      ) {
        ignored++;
        continue;
      }
      const amount = t.amount != null ? new Decimal(Math.abs(t.amount)) : null;
      const price =
        t.value != null && t.value > 0
          ? new Decimal(t.value)
          : amount
            ? amount.div(quantity)
            : null;
      if (!price || price.lte(0)) {
        ignored++;
        continue;
      }
      trades.push({
        tradeDate: day,
        side,
        ticker,
        tickerKnown: known !== null,
        market: null,
        broker,
        quantity,
        price: price.toDecimalPlaces(4),
        grossAmount: (amount ?? price.times(quantity)).toDecimalPlaces(2),
        fees: sumExpenses(t.expenses),
      });
    }
  }
  return { trades, ignored };
}
