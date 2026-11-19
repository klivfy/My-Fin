import Decimal from "decimal.js";
import { fold, normalizeTicker, parseBrDate, parseBrNumber, type NormalizedTrade } from "./common";
import type { Cell } from "./xlsx";

/**
 * Planilha "Negociação" da Área do Investidor da B3 (Extratos > Negociação,
 * exportada em Excel). Uma linha por negócio, de todas as corretoras.
 * Colunas esperadas (a ordem pode variar):
 *   Data do Negócio · Tipo de Movimentação · Mercado · Prazo/Vencimento ·
 *   Instituição · Código de Negociação · Quantidade · Preço · Valor
 */

export class B3ImportError extends Error {}

const COLUMNS = {
  date: ["data do negocio"],
  side: ["tipo de movimentacao"],
  market: ["mercado"],
  broker: ["instituicao"],
  ticker: ["codigo de negociacao"],
  quantity: ["quantidade"],
  price: ["preco"],
  amount: ["valor"],
} as const;

type Column = keyof typeof COLUMNS;
const REQUIRED: Column[] = ["date", "side", "ticker", "quantity", "price"];
const LABEL: Record<Column, string> = {
  date: "Data do Negócio",
  side: "Tipo de Movimentação",
  market: "Mercado",
  broker: "Instituição",
  ticker: "Código de Negociação",
  quantity: "Quantidade",
  price: "Preço",
  amount: "Valor",
};

function mapHeader(row: Cell[]): Partial<Record<Column, number>> {
  const map: Partial<Record<Column, number>> = {};
  row.forEach((cell, i) => {
    if (typeof cell !== "string") return;
    const name = fold(cell);
    for (const [col, names] of Object.entries(COLUMNS) as Array<[Column, readonly string[]]>) {
      if (map[col] === undefined && names.includes(name)) map[col] = i;
    }
  });
  return map;
}

const str = (v: Cell | undefined) => (v === null || v === undefined ? "" : String(v).trim());

export function parseB3Negociacao(rows: Cell[][]): NormalizedTrade[] {
  const headerIdx = rows.findIndex((r) => {
    const m = mapHeader(r);
    return m.date !== undefined && m.ticker !== undefined;
  });
  if (headerIdx < 0) {
    throw new B3ImportError(
      'Não achei o cabeçalho da planilha de negociação da B3 (colunas "Data do Negócio" e "Código de Negociação"). Exporte em Área do Investidor > Extratos > Negociação.',
    );
  }
  const map = mapHeader(rows[headerIdx]);
  const missing = REQUIRED.filter((c) => map[c] === undefined);
  if (missing.length) {
    throw new B3ImportError(`Faltam colunas na planilha: ${missing.map((c) => LABEL[c]).join(", ")}.`);
  }

  const trades: NormalizedTrade[] = [];
  rows.slice(headerIdx + 1).forEach((row, i) => {
    const line = headerIdx + i + 2;
    const get = (c: Column) => (map[c] === undefined ? null : (row[map[c]!] ?? null));
    const rawTicker = str(get("ticker"));
    const rawDate = get("date");
    // Linhas vazias e linhas de total (sem data nem código) são ignoradas.
    if (!rawTicker && (rawDate === null || str(rawDate) === "")) return;

    const tradeDate = parseBrDate(rawDate);
    if (!tradeDate) throw new B3ImportError(`Linha ${line}: data inválida "${str(rawDate)}".`);

    const sideText = fold(str(get("side")));
    const side = sideText.startsWith("compra") ? "BUY" : sideText.startsWith("venda") ? "SELL" : null;
    if (!side) throw new B3ImportError(`Linha ${line}: movimentação "${str(get("side"))}" não é Compra nem Venda.`);

    const quantity = parseBrNumber(get("quantity"));
    if (!quantity || !quantity.isInteger() || quantity.lte(0)) {
      throw new B3ImportError(`Linha ${line}: quantidade inválida "${str(get("quantity"))}".`);
    }
    const price = parseBrNumber(get("price"));
    if (!price || price.lte(0)) throw new B3ImportError(`Linha ${line}: preço inválido "${str(get("price"))}".`);

    const ticker = normalizeTicker(rawTicker);
    const amount = parseBrNumber(get("amount"));
    trades.push({
      tradeDate,
      side,
      ticker: ticker ?? rawTicker.toUpperCase(),
      tickerKnown: true,
      market: str(get("market")) || null,
      broker: str(get("broker")) || null,
      quantity: quantity.toNumber(),
      price,
      grossAmount: (amount ?? price.times(quantity)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
    });
  });

  if (trades.length === 0) throw new B3ImportError("A planilha não tem nenhum negócio.");
  return trades;
}
