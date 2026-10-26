import Decimal from "decimal.js";
import type { DateRange, FinancialAdapter, NormalizedTransaction } from "./financial-adapter";
import { normalizeDescription } from "./reconciliation";

/**
 * Adapter de CSV genérico para extratos bancários. O usuário mapeia as
 * colunas na UI (data/valor/descrição) e o formato de cada campo:
 *
 * - Datas: `dd/mm/aaaa` (padrão BR), `aaaa-mm-dd` (ISO) ou `mm/dd/aaaa`.
 * - Valores: vírgula decimal BR (`1.234,56`) ou ponto (`1234.56`).
 * - Sinal: valor assinado numa única coluna (crédito +, débito −) — padrão —
 *   ou duas colunas separadas (crédito/débito).
 *
 * O parser é tolerante a aspas (campos entre "…"), delimitadores `;` ou `,`
 * (auto-detectado pela primeira linha) e linhas em branco.
 */

export type CsvDateFormat = "dd/mm/yyyy" | "yyyy-mm-dd" | "mm/dd/yyyy";
export type CsvAmountFormat = "br" | "intl";

export interface CsvColumnMapping {
  /** Índice 0-based da coluna de data (obrigatório). */
  date: number;
  /** Índice da coluna de descrição (obrigatório). */
  description: number;
  /** Índice da coluna de valor assinado (mutuamente exclusivo com credit/debit). */
  amount?: number;
  /** Índices de colunas separadas de crédito/débito (alternativa a `amount`). */
  credit?: number;
  debit?: number;
  dateFormat: CsvDateFormat;
  amountFormat: CsvAmountFormat;
  /** Se a primeira linha é cabeçalho (pulada). */
  hasHeader: boolean;
}

/** Detecta o delimitador mais provável pela linha de cabeçalho. */
function detectDelimiter(line: string): string {
  const semicolons = (line.match(/;/g) ?? []).length;
  const commas = (line.match(/,/g) ?? []).length;
  return semicolons > commas ? ";" : ",";
}

/** Split respeitando aspas duplas ("a;b";c). */
function splitCsvLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === delimiter && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

function parseCsvDate(raw: string, format: CsvDateFormat): Date {
  const parts = raw.split(/[/-]/).map((p) => Number(p));
  if (parts.length !== 3 || parts.some((p) => !Number.isFinite(p))) {
    throw new Error(`Data inválida no CSV: "${raw}".`);
  }
  let year: number, month: number, day: number;
  if (format === "yyyy-mm-dd") {
    [year, month, day] = parts as [number, number, number];
  } else if (format === "mm/dd/yyyy") {
    [month, day, year] = parts as [number, number, number];
  } else {
    [day, month, year] = parts as [number, number, number];
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error(`Data inválida no CSV: "${raw}".`);
  }
  return new Date(Date.UTC(year, month - 1, day));
}

function parseCsvAmount(raw: string, format: CsvAmountFormat): Decimal {
  const trimmed = raw.trim().replace(/[R$\s]/g, "");
  if (!trimmed) return new Decimal(0);
  const normalized =
    format === "br" ? trimmed.replace(/\./g, "").replace(",", ".") : trimmed.replace(/,/g, "");
  try {
    const value = new Decimal(normalized);
    if (!value.isFinite()) throw new Error("not finite");
    return value;
  } catch {
    throw new Error(`Valor inválido no CSV: "${raw}".`);
  }
}

export class CsvAdapter implements FinancialAdapter {
  readonly source = "CSV_IMPORT" as const;

  constructor(
    private readonly content: string,
    private readonly mapping: CsvColumnMapping,
  ) {}

  parsePayload(data: unknown): unknown[] {
    const text = typeof data === "string" ? data : this.content;
    const lines = text.replace(/\r\n/g, "\n").split("\n").filter((line) => line.trim().length > 0);
    if (lines.length === 0) return [];

    const delimiter = detectDelimiter(lines[0]!);
    const rows = lines.map((line) => splitCsvLine(line, delimiter));
    return this.mapping.hasHeader ? rows.slice(1) : rows;
  }

  normalize(raw: unknown): NormalizedTransaction {
    const fields = raw as string[];
    const get = (index: number | undefined): string =>
      index !== undefined && index < fields.length ? (fields[index] ?? "") : "";

    const date = parseCsvDate(get(this.mapping.date), this.mapping.dateFormat);
    const originalDescription = get(this.mapping.description).trim();

    let amount: Decimal;
    if (this.mapping.amount !== undefined) {
      amount = parseCsvAmount(get(this.mapping.amount), this.mapping.amountFormat);
    } else {
      const credit = parseCsvAmount(get(this.mapping.credit), this.mapping.amountFormat);
      const debit = parseCsvAmount(get(this.mapping.debit), this.mapping.amountFormat);
      amount = credit.minus(debit.abs());
    }

    if (!originalDescription) {
      throw new Error("Linha do CSV sem descrição.");
    }

    return {
      date,
      amount,
      description: normalizeDescription(originalDescription),
      originalDescription,
    };
  }

  async fetchTransactions(range: DateRange): Promise<NormalizedTransaction[]> {
    return this.parsePayload(this.content)
      .map((row) => this.normalize(row))
      .filter((transaction) => transaction.date >= range.from && transaction.date <= range.to);
  }
}
