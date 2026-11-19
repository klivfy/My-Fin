import Decimal from "decimal.js";
import { findTicker, fold, parseBrDate, parseBrNumber, type NormalizedTrade, type Side } from "./common";

/**
 * Nota de corretagem no padrão SINACOR (usado por XP, BTG e quase todas as
 * corretoras de bolsa). Recebe o TEXTO já extraído do PDF, uma string por
 * página. Uma nota pode ocupar várias páginas (o resumo financeiro só vem
 * na última) e um PDF pode trazer várias notas.
 *
 * Nada de identificação do cliente (nome, CPF, conta) é lido ou devolvido.
 */

export class NotaError extends Error {}

export interface NoteFees {
  settlementFee: Decimal;
  registrationFee: Decimal;
  emoluments: Decimal;
  brokerage: Decimal;
  taxes: Decimal;
  otherFees: Decimal;
}

export interface ParsedNote {
  broker: string;
  noteNumber: string;
  tradeDate: string;
  trades: NormalizedTrade[];
  fees: NoteFees;
  totalFees: Decimal;
  irrf: Decimal;
  /** Assinado: positivo = crédito ao cliente. */
  netAmount: Decimal;
  settlementDate: string | null;
  /** Diferença entre o líquido calculado e o impresso (deve ser zero). */
  difference: Decimal;
}

const MONEY = /\d{1,3}(?:\.\d{3})*,\d{2,8}/g;
const ZERO = new Decimal(0);

const MARKETS = [
  "VISTA",
  "FRACIONARIO",
  "OPCAO DE COMPRA",
  "OPCAO DE VENDA",
  "EXERC OPC COMPRA",
  "EXERC OPC VENDA",
  "TERMO",
];

/**
 * Linha de "Negócios realizados":
 *   1-BOVESPA C VISTA ABCD3 ON NM 100 10,50 1.050,00 D
 * (prazo opcional para opções e termo; obs. como "D" ou "#" ficam na
 * especificação e não atrapalham).
 */
const TRADE_LINE = new RegExp(
  String.raw`^(?:\d-)?BOVESPA\s+([CV])\s+(${MARKETS.join("|")})\s+(?:(\d{2}\/\d{2,4})\s+)?(.+?)\s+(\d{1,3}(?:\.\d{3})*)\s+(\d{1,3}(?:\.\d{3})*,\d{2,8})\s+(\d{1,3}(?:\.\d{3})*,\d{2})\s+([DC])\s*$`,
);

function lastMoney(line: string): Decimal | null {
  const all = line.match(MONEY);
  return all ? parseBrNumber(all[all.length - 1]) : null;
}

function detectBroker(text: string): string {
  const t = fold(text);
  if (t.includes("xp investimentos")) return "XP";
  if (t.includes("btg pactual")) return "BTG";
  if (t.includes("clear corretora")) return "Clear";
  if (t.includes("rico investimentos")) return "Rico";
  return "Outra";
}

/** Número e data do pregão: no cabeçalho, como "Nr. nota  Folha  Data pregão" seguido dos valores. */
function readHeader(lines: string[]): { noteNumber: string; tradeDate: string } | null {
  for (let i = 0; i < lines.length; i++) {
    if (!/nr\.?\s*nota/.test(fold(lines[i]))) continue;
    for (const candidate of [lines[i], lines[i + 1] ?? "", lines[i + 2] ?? ""]) {
      const m = /(\d{1,12})\s+(?:\d{1,3}\s+)?(\d{2}\/\d{2}\/\d{4})/.exec(candidate);
      const date = m ? parseBrDate(m[2]) : null;
      if (m && date) return { noteNumber: String(Number(m[1])), tradeDate: date };
    }
  }
  return null;
}

interface Partial {
  broker: string;
  noteNumber: string;
  tradeDate: string;
  trades: NormalizedTrade[];
  fees: NoteFees;
  irrf: Decimal;
  net: { amount: Decimal; date: string | null } | null;
}

const FEE_LABELS: Array<[RegExp, keyof NoteFees]> = [
  [/^taxa de liquidacao/, "settlementFee"],
  [/^taxa de registro/, "registrationFee"],
  [/^taxa de termo\s*\/\s*opcoes/, "otherFees"],
  [/^taxa a\.?n\.?a\.?/, "otherFees"],
  [/^emolumentos/, "emoluments"],
  [/^(taxa operacional|corretagem)/, "brokerage"],
  [/^execucao/, "brokerage"],
  [/^taxa de custodia/, "otherFees"],
  [/^(impostos|iss)/, "taxes"],
  [/^outros(?! bovespa)/, "otherFees"],
];

export function parseNotaSinacor(pages: string[]): ParsedNote[] {
  const notes = new Map<string, Partial>();
  const order: string[] = [];

  for (const page of pages) {
    const lines = page
      .split(/\r?\n/)
      .map((l) => l.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const header = readHeader(lines);
    if (!header) continue;

    const broker = detectBroker(page);
    const key = `${broker}|${header.noteNumber}`;
    let note = notes.get(key);
    if (!note) {
      note = {
        broker,
        ...header,
        trades: [],
        fees: {
          settlementFee: ZERO,
          registrationFee: ZERO,
          emoluments: ZERO,
          brokerage: ZERO,
          taxes: ZERO,
          otherFees: ZERO,
        },
        irrf: ZERO,
        net: null,
      };
      notes.set(key, note);
      order.push(key);
    }

    for (const line of lines) {
      const folded = fold(line);
      const trade = TRADE_LINE.exec(folded.toUpperCase());
      if (trade) {
        const [, cv, market, , spec, qty, priceText, amountText] = trade;
        const ticker = findTicker(spec);
        note.trades.push({
          tradeDate: note.tradeDate,
          side: (cv === "C" ? "BUY" : "SELL") as Side,
          ticker: ticker ?? spec.replace(/\s+[#D]$/, "").trim(),
          tickerKnown: ticker !== null,
          market,
          broker: note.broker,
          quantity: Number(qty.replace(/\./g, "")),
          price: parseBrNumber(priceText)!,
          grossAmount: parseBrNumber(amountText)!,
        });
        continue;
      }

      if (/^i\.?r\.?r\.?f\.?/.test(folded)) {
        note.irrf = note.irrf.plus(lastMoney(line) ?? ZERO);
        continue;
      }
      const liquid = /^liquido para (\d{2}\/\d{2}\/\d{4})/.exec(folded);
      if (liquid) {
        const amount = lastMoney(line);
        if (amount) {
          const signed = /\bD\s*$/.test(line) ? amount.negated() : amount;
          note.net = { amount: signed, date: parseBrDate(liquid[1]) };
        }
        continue;
      }
      for (const [re, field] of FEE_LABELS) {
        if (re.test(folded)) {
          note.fees[field] = note.fees[field].plus(lastMoney(line) ?? ZERO);
          break;
        }
      }
    }
  }

  if (order.length === 0) {
    throw new NotaError("Não reconheci nenhuma nota de corretagem no padrão SINACOR neste PDF.");
  }

  return order.map((key) => {
    const n = notes.get(key)!;
    if (n.trades.length === 0) throw new NotaError(`Nota ${n.noteNumber}: nenhum negócio encontrado.`);
    if (!n.net) throw new NotaError(`Nota ${n.noteNumber}: não achei o "Líquido para" no resumo financeiro.`);
    const totalFees = Object.values(n.fees).reduce((s: Decimal, v: Decimal) => s.plus(v), ZERO);
    const operations = n.trades.reduce(
      (s, t) => (t.side === "SELL" ? s.plus(t.grossAmount) : s.minus(t.grossAmount)),
      ZERO,
    );
    const computed = operations.minus(totalFees).minus(n.irrf);
    return {
      broker: n.broker,
      noteNumber: n.noteNumber,
      tradeDate: n.tradeDate,
      trades: n.trades,
      fees: n.fees,
      totalFees,
      irrf: n.irrf,
      netAmount: n.net.amount,
      settlementDate: n.net.date,
      difference: computed.minus(n.net.amount),
    };
  });
}

/**
 * Rateia os custos da nota entre os negócios, proporcional ao valor de cada
 * um (critério usual para preço médio). A soma dos rateios é exatamente o
 * total: o resto do arredondamento vai para o maior negócio.
 */
export function allocateFees(amounts: Decimal[], total: Decimal): Decimal[] {
  if (amounts.length === 0) return [];
  const sum = amounts.reduce((s, a) => s.plus(a), ZERO);
  if (sum.isZero()) return amounts.map((_, i) => (i === 0 ? total : ZERO));
  const shares = amounts.map((a) => total.times(a).div(sum).toDecimalPlaces(2, Decimal.ROUND_DOWN));
  const rest = total.minus(shares.reduce((s, a) => s.plus(a), ZERO));
  let biggest = 0;
  amounts.forEach((a, i) => {
    if (a.gt(amounts[biggest])) biggest = i;
  });
  shares[biggest] = shares[biggest].plus(rest);
  return shares;
}
