/**
 * Gera os ícones PWA programaticamente (PNG hand-rolled via zlib — sem
 * dependências nativas): fundo escuro com o monograma "MF" em pixel-art.
 * Suficiente para instalabilidade; substitua por arte final quando houver.
 *
 * Executar: `node scripts/generate-icons.mjs`
 */
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const BG = [23, 23, 23]; // quase preto (tema escuro)
const FG = [250, 250, 250]; // branco

// Glyphs 5x7 para M e F (1 = pixel aceso).
const GLYPHS = {
  M: [
    [1, 0, 0, 0, 1],
    [1, 1, 0, 1, 1],
    [1, 0, 1, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
  ],
  F: [
    [1, 1, 1, 1, 1],
    [1, 0, 0, 0, 0],
    [1, 0, 0, 0, 0],
    [1, 1, 1, 1, 0],
    [1, 0, 0, 0, 0],
    [1, 0, 0, 0, 0],
    [1, 0, 0, 0, 0],
  ],
};

function renderPng(size, { maskable = false } = {}) {
  const pixels = new Uint8Array(size * size * 3);
  for (let i = 0; i < size * size; i++) {
    pixels[i * 3] = BG[0];
    pixels[i * 3 + 1] = BG[1];
    pixels[i * 3 + 2] = BG[2];
  }

  // Zona segura: maskable exige o conteúdo no centro (margem ~20%).
  const safeFraction = maskable ? 0.5 : 0.6;
  const glyphW = 5;
  const gap = 1;
  const totalUnits = glyphW * 2 + gap; // M + espaço + F
  const pixel = Math.max(1, Math.floor((size * safeFraction) / 7));
  const totalWidth = totalUnits * pixel;
  const startX = Math.floor((size - totalWidth) / 2);
  const startY = Math.floor((size - 7 * pixel) / 2);

  function drawGlyph(glyph, offsetX) {
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (!glyph[row][col]) continue;
        for (let dy = 0; dy < pixel; dy++) {
          for (let dx = 0; dx < pixel; dx++) {
            const x = startX + (offsetX + col) * pixel + dx;
            const y = startY + row * pixel + dy;
            if (x < 0 || y < 0 || x >= size || y >= size) continue;
            const idx = (y * size + x) * 3;
            pixels[idx] = FG[0];
            pixels[idx + 1] = FG[1];
            pixels[idx + 2] = FG[2];
          }
        }
      }
    }
  }

  drawGlyph(GLYPHS.M, 0);
  drawGlyph(GLYPHS.F, glyphW + gap);

  return encodePng(size, size, pixels);
}

function crc32(buf) {
  let crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}

function encodePng(width, height, rgb) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    Buffer.from(rgb.buffer, y * width * 3, width * 3).copy(raw, y * (width * 3 + 1) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const outDir = new URL("../public/icons/", import.meta.url).pathname;
writeFileSync(`${outDir}icon-192.png`, renderPng(192));
writeFileSync(`${outDir}icon-512.png`, renderPng(512));
writeFileSync(`${outDir}icon-maskable-192.png`, renderPng(192, { maskable: true }));
writeFileSync(`${outDir}icon-maskable-512.png`, renderPng(512, { maskable: true }));
writeFileSync(`${outDir}apple-touch-icon.png`, renderPng(180));

// Favicon 32×32: PNG servido em /favicon.ico (browsers modernos aceitam
// conteúdo PNG nesse caminho; é o que o Next já faz com src/app/favicon.ico).
writeFileSync(new URL("../public/favicon.ico", import.meta.url).pathname, renderPng(32));
console.log("Ícones gerados em public/icons/");
