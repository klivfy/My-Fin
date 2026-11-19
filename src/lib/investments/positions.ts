import Decimal from "decimal.js";
import type { Side } from "./common";

/**
 * Preço médio e resultado a partir dos negócios executados.
 *
 * Regras (as da Receita para ações à vista):
 * - Custo de compra inclui os custos rateados da nota; a venda desconta os
 *   custos do valor recebido.
 * - Compra e venda do mesmo ativo no mesmo dia: a quantidade casada é day
 *   trade, apurada à parte e fora do preço médio. Só o saldo do dia mexe na
 *   posição de swing.
 * - Venda acima da posição (venda a descoberto) não é suportada: o ativo
 *   fica marcado como inconsistente em vez de gerar número errado.
 *
 * Não trata ainda desdobramento, grupamento e bonificação (dependem da
 * planilha de movimentação, próxima etapa).
 */

export interface PositionTrade {
  tradeDate: string;
  side: Side;
  ticker: string;
  quantity: number;
  price: Decimal;
  grossAmount: Decimal;
  fees: Decimal;
}

export interface Position {
  ticker: string;
  quantity: number;
  /** Custo médio por unidade, com custos. Zero se a posição está zerada. */
  averagePrice: Decimal;
  totalCost: Decimal;
  realizedSwing: Decimal;
  realizedDayTrade: Decimal;
  inconsistent: boolean;
}

const ZERO = new Decimal(0);

export function computePositions(trades: PositionTrade[]): Position[] {
  const byTicker = new Map<string, PositionTrade[]>();
  for (const t of trades) byTicker.set(t.ticker, [...(byTicker.get(t.ticker) ?? []), t]);

  const positions: Position[] = [];
  for (const [ticker, list] of byTicker) {
    const days = new Map<string, PositionTrade[]>();
    for (const t of list) days.set(t.tradeDate, [...(days.get(t.tradeDate) ?? []), t]);

    let quantity = 0;
    let totalCost = ZERO;
    let realizedSwing = ZERO;
    let realizedDayTrade = ZERO;
    let inconsistent = false;

    for (const date of [...days.keys()].sort()) {
      const dayTrades = days.get(date)!;
      const sum = (side: Side) => {
        const ts = dayTrades.filter((t) => t.side === side);
        return {
          qty: ts.reduce((s, t) => s + t.quantity, 0),
          // compra: valor + custos; venda: valor - custos
          value: ts.reduce(
            (s, t) => s.plus(side === "BUY" ? t.grossAmount.plus(t.fees) : t.grossAmount.minus(t.fees)),
            ZERO,
          ),
        };
      };
      const buy = sum("BUY");
      const sell = sum("SELL");

      const dtQty = Math.min(buy.qty, sell.qty);
      if (dtQty > 0) {
        const buyUnit = buy.value.div(buy.qty);
        const sellUnit = sell.value.div(sell.qty);
        realizedDayTrade = realizedDayTrade.plus(sellUnit.minus(buyUnit).times(dtQty));
      }

      const netBuy = buy.qty - dtQty;
      const netSell = sell.qty - dtQty;
      if (netBuy > 0) {
        totalCost = totalCost.plus(buy.value.div(buy.qty).times(netBuy));
        quantity += netBuy;
      }
      if (netSell > 0) {
        if (netSell > quantity) {
          inconsistent = true;
          continue;
        }
        const avg = totalCost.div(quantity);
        const sellUnit = sell.value.div(sell.qty);
        realizedSwing = realizedSwing.plus(sellUnit.minus(avg).times(netSell));
        totalCost = totalCost.minus(avg.times(netSell));
        quantity -= netSell;
        if (quantity === 0) totalCost = ZERO;
      }
    }

    positions.push({
      ticker,
      quantity,
      averagePrice: quantity > 0 ? totalCost.div(quantity) : ZERO,
      totalCost: quantity > 0 ? totalCost : ZERO,
      realizedSwing,
      realizedDayTrade,
      inconsistent,
    });
  }
  return positions.sort((a, b) => b.quantity - a.quantity || a.ticker.localeCompare(b.ticker));
}
