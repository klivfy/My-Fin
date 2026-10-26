/**
 * Empacota a extensão para as lojas:
 *
 *   node scripts/package-extension.mjs chromium  → dist/myfin-chromium.zip
 *   node scripts/package-extension.mjs firefox   → dist/myfin-firefox.zip
 *
 * Sem dependências externas: ZIP hand-rolled (stored, sem compressão — os
 * arquivos são pequenos e as lojas recompactam no servidor).
 *
 * - chromium: usa extension/manifest.json (MV3 com service_worker).
 * - firefox:  usa extension/manifest.firefox.json renomeado (gecko settings).
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { deflateRawSync } from "node:zlib";

const target = process.argv[2];
if (!["chromium", "firefox"].includes(target)) {
  console.error("Uso: node scripts/package-extension.mjs <chromium|firefox>");
  process.exit(1);
}

const srcDir = new URL("../extension/", import.meta.url).pathname;
const outDir = new URL("../dist/", import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });

// Coleta os arquivos do pacote.
const files = [];
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else files.push(full);
  }
}
walk(srcDir);

const entries = files
  .map((full) => {
    const rel = relative(srcDir, full).replaceAll("\\", "/");
    return { rel, data: readFileSync(full) };
  })
  // O manifest da outra loja nunca entra no pacote (o do Firefox vira
  // "manifest.json" no passo seguinte).
  .filter((e) => e.rel !== "manifest.firefox.json");

// Firefox: substitui o manifest padrão pelo adaptado (gecko settings).
if (target === "firefox") {
  const withoutDefault = entries.filter((e) => e.rel !== "manifest.json");
  withoutDefault.push({
    rel: "manifest.json",
    data: readFileSync(join(srcDir, "manifest.firefox.json")),
  });
  entries.length = 0;
  entries.push(...withoutDefault);
}

// --- ZIP (deflate) ---
function crc32(buf) {
  let crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

const localParts = [];
const centralParts = [];
let offset = 0;

for (const { rel, data } of entries) {
  const nameBuf = Buffer.from(rel, "utf8");
  const compressed = deflateRawSync(data, { level: 9 });
  const crc = crc32(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0x0800, 6); // UTF-8 flag
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt16LE(0, 10);
  local.writeUInt16LE(0, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);
  localParts.push(local, nameBuf, compressed);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(0, 12);
  central.writeUInt16LE(0, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE(0, 38);
  central.writeUInt32LE(offset, 42);
  centralParts.push(central, nameBuf);

  offset += 30 + nameBuf.length + compressed.length;
}

const centralStart = offset;
const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(entries.length, 8);
end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(centralStart, 16);
end.writeUInt16LE(0, 20);

const zip = Buffer.concat([...localParts, ...centralParts, end]);
const outFile = join(outDir, `myfin-${target}.zip`);
writeFileSync(outFile, zip);
console.log(`Pacote gerado: ${outFile} (${entries.length} arquivos, ${zip.length} bytes)`);
