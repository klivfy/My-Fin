import zlib from "node:zlib";

/**
 * Leitor mínimo de .xlsx (só a primeira planilha, só valores), sem
 * dependência externa: um .xlsx é um ZIP com XML dentro. Basta para as
 * planilhas exportadas pela Área do Investidor da B3. Fórmulas, estilos e
 * várias abas não são suportados de propósito.
 *
 * Limites contra arquivo malicioso: no máximo 2.000 entradas no ZIP e
 * 20 MB descompactados por entrada.
 */

export type Cell = string | number | boolean | null;

export class XlsxError extends Error {}

const MAX_ENTRIES = 2000;
const MAX_INFLATED = 20 * 1024 * 1024;

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localOffset: number;
}

function readCentralDirectory(buf: Buffer): Map<string, ZipEntry> {
  // O registro "end of central directory" fica nos últimos 22 + 65535 bytes.
  const minPos = Math.max(0, buf.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = buf.length - 22; i >= minPos; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new XlsxError("O arquivo não é uma planilha .xlsx válida.");

  const count = buf.readUInt16LE(eocd + 10);
  if (count > MAX_ENTRIES) throw new XlsxError("Planilha com estrutura grande demais.");
  let pos = buf.readUInt32LE(eocd + 16);

  const entries = new Map<string, ZipEntry>();
  for (let n = 0; n < count; n++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== 0x02014b50) {
      throw new XlsxError("Planilha .xlsx corrompida.");
    }
    const method = buf.readUInt16LE(pos + 10);
    const compressedSize = buf.readUInt32LE(pos + 20);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localOffset = buf.readUInt32LE(pos + 42);
    const name = buf.toString("utf8", pos + 46, pos + 46 + nameLen);
    entries.set(name, { name, method, compressedSize, localOffset });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readEntry(buf: Buffer, entry: ZipEntry): string {
  const p = entry.localOffset;
  if (p + 30 > buf.length || buf.readUInt32LE(p) !== 0x04034b50) {
    throw new XlsxError("Planilha .xlsx corrompida.");
  }
  const start = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28);
  const data = buf.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return data.toString("utf8");
  if (entry.method === 8) {
    try {
      return zlib.inflateRawSync(data, { maxOutputLength: MAX_INFLATED }).toString("utf8");
    } catch {
      throw new XlsxError("Não foi possível descompactar a planilha.");
    }
  }
  throw new XlsxError("Compressão da planilha não suportada.");
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return String.fromCodePoint(code);
    }
    return ENTITIES[e.toLowerCase()];
  });
}

/** Junta todos os <t> de um trecho (texto rico vem quebrado em vários <r><t>). */
function textOf(xml: string): string {
  let out = "";
  for (const m of xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) out += m[1];
  return decodeXml(out);
}

function attr(attrs: string, name: string): string | undefined {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1];
}

/** "AB12" → 27 (índice de coluna a partir de 0). */
export function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function firstSheetPath(entries: Map<string, ZipEntry>, buf: Buffer): string {
  const workbook = entries.get("xl/workbook.xml");
  const rels = entries.get("xl/_rels/workbook.xml.rels");
  if (workbook && rels) {
    const rid = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(readEntry(buf, workbook))?.[1];
    if (rid) {
      for (const m of readEntry(buf, rels).matchAll(/<Relationship\b([^>]*)\/?>/g)) {
        if (attr(m[1], "Id") === rid) {
          const target = attr(m[1], "Target") ?? "";
          const path = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
          if (entries.has(path)) return path;
        }
      }
    }
  }
  if (entries.has("xl/worksheets/sheet1.xml")) return "xl/worksheets/sheet1.xml";
  const any = [...entries.keys()].filter((k) => /^xl\/worksheets\/[^/]+\.xml$/.test(k)).sort()[0];
  if (!any) throw new XlsxError("A planilha não tem nenhuma aba.");
  return any;
}

/** Linhas da primeira aba, na ordem do arquivo. Células vazias viram `null`. */
export function readFirstSheet(data: Buffer): Cell[][] {
  const entries = readCentralDirectory(data);
  const sharedEntry = entries.get("xl/sharedStrings.xml");
  const shared = sharedEntry
    ? [...readEntry(data, sharedEntry).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]))
    : [];

  const sheet = readEntry(data, entries.get(firstSheetPath(entries, data))!);
  const rows: Cell[][] = [];
  for (const rowMatch of sheet.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const row: Cell[] = [];
    let next = 0;
    for (const c of (rowMatch[1] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const body = c[2] ?? "";
      const ref = attr(attrs, "r");
      const col = ref ? columnIndex(ref) : next;
      next = col + 1;
      const type = attr(attrs, "t");
      const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value: Cell = null;
      if (type === "s") value = raw === undefined ? null : (shared[Number(raw)] ?? null);
      else if (type === "inlineStr") value = textOf(body);
      else if (type === "str" || type === "e") value = raw === undefined ? null : decodeXml(raw);
      else if (type === "b") value = raw === "1";
      else if (raw !== undefined && raw !== "") value = Number(raw);
      while (row.length < col) row.push(null);
      row[col] = value;
    }
    rows.push(row);
  }
  return rows;
}
