import { createHash } from "node:crypto";
import Decimal from "decimal.js";

/**
 * Leitor do `diario.csv` escrito pelo b3-diario (trader-b3/comum/b3comum.py,
 * `COLUNAS_DIARIO`). Só leitura: o app nunca escreve no diário.
 */
export const DIARIO_COLUMNS = [
  "data",
  "data_entrada",
  "ativo",
  "classe",
  "estilo",
  "setup",
  "entrada",
  "stop",
  "alvo",
  "quantidade",
  "saida",
  "custos",
  "resultado_rs",
  "resultado_r",
  "motivo_saida",
  "emocao",
  "nota",
  "modo",
] as const;

const REQUIRED = ["data", "ativo"] as const;

export type DiarioMode = "REAL" | "SIMULADO";

export interface DiarioRow {
  date: string; // AAAA-MM-DD
  entryDate: string | null;
  ticker: string;
  assetClass: string | null;
  style: string | null;
  setup: string | null;
  entryPrice: Decimal | null;
  stopPrice: Decimal | null;
  targetPrice: Decimal | null;
  exitPrice: Decimal | null;
  quantity: number;
  costs: Decimal | null;
  resultBrl: Decimal | null;
  resultR: Decimal | null;
  exitReason: string | null;
  emotion: string | null;
  note: string | null;
  mode: DiarioMode;
  importHash: string;
}

export class DiarioError extends Error {}

/** CSV RFC 4180 (aspas, vírgulas e quebras de linha dentro de campos). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function text(v: string | undefined): string | null {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
}

function date(v: string | undefined, where: string, field: string): string | null {
  const t = text(v);
  if (t === null) return null;
  if (!DATE_RE.test(t) || Number.isNaN(Date.parse(`${t}T00:00:00Z`))) {
    throw new DiarioError(`${where}: ${field} "${t}" não é uma data AAAA-MM-DD.`);
  }
  return t;
}

function decimal(v: string | undefined, where: string, field: string): Decimal | null {
  const t = text(v);
  if (t === null) return null;
  try {
    const d = new Decimal(t);
    if (!d.isFinite()) throw new Error();
    return d;
  } catch {
    throw new DiarioError(`${where}: ${field} "${t}" não é um número.`);
  }
}

function hashRow(cells: Record<string, string>): string {
  const canonical = DIARIO_COLUMNS.map((c) => (cells[c] ?? "").trim()).join("\u001f");
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Converte o texto do CSV em linhas validadas. Falha inteira na primeira
 * linha inválida, citando a linha, para nunca importar meio diário.
 */
export function parseDiario(csvText: string): DiarioRow[] {
  const rows = parseCsv(csvText);
  if (rows.length === 0) throw new DiarioError("O arquivo está vazio.");

  const header = rows[0].map((h) => h.trim());
  const missing = REQUIRED.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    throw new DiarioError(
      `Cabeçalho sem ${missing.join(" e ")}. Envie o diario.csv gerado pelo b3-diario.`,
    );
  }

  return rows.slice(1).map((cells, index) => {
    const where = `Linha ${index + 2}`;
    const rec: Record<string, string> = {};
    header.forEach((h, i) => (rec[h] = cells[i] ?? ""));

    const day = date(rec.data, where, "data");
    const ticker = text(rec.ativo);
    if (!day) throw new DiarioError(`${where}: falta a data.`);
    if (!ticker) throw new DiarioError(`${where}: falta o ativo.`);

    const qty = decimal(rec.quantidade, where, "quantidade");
    const modeText = (text(rec.modo) ?? "real").toLowerCase();
    if (modeText !== "real" && modeText !== "simulado") {
      throw new DiarioError(`${where}: modo "${rec.modo}" deve ser real ou simulado.`);
    }

    return {
      date: day,
      entryDate: date(rec.data_entrada, where, "data_entrada"),
      ticker: ticker.toUpperCase(),
      assetClass: text(rec.classe),
      style: text(rec.estilo),
      setup: text(rec.setup),
      entryPrice: decimal(rec.entrada, where, "entrada"),
      stopPrice: decimal(rec.stop, where, "stop"),
      targetPrice: decimal(rec.alvo, where, "alvo"),
      exitPrice: decimal(rec.saida, where, "saida"),
      quantity: qty ? qty.trunc().toNumber() : 0,
      costs: decimal(rec.custos, where, "custos"),
      resultBrl: decimal(rec.resultado_rs, where, "resultado_rs"),
      resultR: decimal(rec.resultado_r, where, "resultado_r"),
      exitReason: text(rec.motivo_saida),
      emotion: text(rec.emocao),
      note: text(rec.nota),
      mode: modeText === "simulado" ? "SIMULADO" : "REAL",
      importHash: hashRow(rec),
    } satisfies DiarioRow;
  });
}
