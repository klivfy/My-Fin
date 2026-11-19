import crypto from "node:crypto";
import Decimal from "decimal.js";

export type Side = "BUY" | "SELL";

/** Negócio normalizado, igual para qualquer fonte (B3, nota, agregador). */
export interface NormalizedTrade {
  /** YYYY-MM-DD */
  tradeDate: string;
  side: Side;
  /** Código sem sufixo F; na nota sem código, a especificação do título. */
  ticker: string;
  /** true quando `ticker` é um código de negociação de verdade. */
  tickerKnown: boolean;
  market: string | null;
  broker: string | null;
  quantity: number;
  price: Decimal;
  grossAmount: Decimal;
}

/** Minúsculas, sem acento, espaços colapsados: para comparar cabeçalhos e rótulos. */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const TICKER = /^[A-Z]{4}\d{1,2}$/;

/** "abcd3f" → "ABCD3"; devolve null se não parece código de negociação. */
export function normalizeTicker(raw: string): string | null {
  const t = raw.trim().toUpperCase();
  if (TICKER.test(t)) return t;
  if (/^[A-Z]{4}\d{1,2}F$/.test(t)) return t.slice(0, -1);
  return null;
}

/** Procura um código de negociação dentro de um texto ("ABCD3 ON NM" → "ABCD3"). */
export function findTicker(text: string): string | null {
  for (const word of text.toUpperCase().split(/[\s/]+/)) {
    const t = normalizeTicker(word);
    if (t) return t;
  }
  return null;
}

/**
 * Número em formato brasileiro ou já numérico: "R$ 1.234,56" → 1234.56.
 * Devolve null para vazio ou texto que não é número.
 */
export function parseBrNumber(value: unknown): Decimal | null {
  if (typeof value === "number") return Number.isFinite(value) ? new Decimal(value) : null;
  if (typeof value !== "string") return null;
  let s = value.replace(/R\$|\s/g, "");
  if (s === "" || s === "-") return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return new Decimal(s);
}

/** Data serial do Excel (dias desde 1899-12-30) → YYYY-MM-DD. */
function fromExcelSerial(serial: number): string {
  return new Date(Math.round((serial - 25569) * 864e5)).toISOString().slice(0, 10);
}

/** "05/11/2026", "2026-11-05" ou serial do Excel → "2026-11-05". */
export function parseBrDate(value: unknown): string | null {
  if (typeof value === "number" && value > 20000 && value < 80000) return fromExcelSerial(value);
  if (typeof value !== "string") return null;
  const s = value.trim();
  let m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (m) return validDate(`${m[3]}-${m[2]}-${m[1]}`);
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return validDate(`${m[1]}-${m[2]}-${m[3]}`);
  return null;
}

function validDate(iso: string): string | null {
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}

function baseKey(t: Pick<NormalizedTrade, "tradeDate" | "side" | "ticker" | "quantity" | "price">): string {
  return [t.tradeDate, t.side, t.ticker.toUpperCase(), t.quantity, t.price.toFixed(4)].join("|");
}

/**
 * Chave de deduplicação por negócio. Dois negócios idênticos no mesmo dia
 * (mesmo preço, mesma quantidade) são legítimos, então a chave inclui a
 * ocorrência dentro do arquivo: reimportar o mesmo arquivo gera as mesmas
 * chaves e não duplica nada.
 */
export function withMatchKeys<T extends NormalizedTrade>(trades: T[]): Array<T & { matchKey: string }> {
  const seen = new Map<string, number>();
  return trades.map((t) => {
    const base = baseKey(t);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return { ...t, matchKey: crypto.createHash("sha256").update(`${base}|${n}`).digest("hex") };
  });
}

/** Identidade de um negócio entre fontes diferentes: data, lado, quantidade e preço. */
export function crossSourceKey(t: { tradeDate: string; side: Side; quantity: number; price: Decimal }): string {
  return [t.tradeDate, t.side, t.quantity, t.price.toFixed(4)].join("|");
}

/**
 * Pareia negócios novos com os já gravados vindos de outra fonte. Cada
 * existente casa com no máximo um novo; quando os dois têm código de
 * negociação, o código também precisa bater.
 */
export function pairAcrossSources<
  N extends { tradeDate: string; side: Side; quantity: number; price: Decimal; ticker: string; tickerKnown: boolean },
  E extends { id: string; tradeDate: string; side: Side; quantity: number; price: Decimal; ticker: string; tickerKnown: boolean },
>(incoming: N[], existing: E[]): { pairs: Array<{ incoming: N; existing: E }>; unmatched: N[] } {
  const pool = new Map<string, E[]>();
  for (const e of existing) {
    const k = crossSourceKey(e);
    pool.set(k, [...(pool.get(k) ?? []), e]);
  }
  const pairs: Array<{ incoming: N; existing: E }> = [];
  const unmatched: N[] = [];
  for (const n of incoming) {
    const candidates = pool.get(crossSourceKey(n)) ?? [];
    const idx = candidates.findIndex(
      (e) => !(n.tickerKnown && e.tickerKnown) || e.ticker.toUpperCase() === n.ticker.toUpperCase(),
    );
    if (idx < 0) {
      unmatched.push(n);
      continue;
    }
    pairs.push({ incoming: n, existing: candidates[idx] });
    candidates.splice(idx, 1);
  }
  return { pairs, unmatched };
}
