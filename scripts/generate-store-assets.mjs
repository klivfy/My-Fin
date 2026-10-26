/**
 * Gera o feature graphic da Play Store (1024×500): fundo escuro com o
 * monograma "MF" à esquerda e o nome do app ao lado (pixel-art ampliado).
 *
 * Executar: `node scripts/generate-store-assets.mjs`
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const BG = [23, 23, 23];
const FG = [250, 250, 250];

// Mesmos glyphs 7×7 do gerador de ícones.
const GLYPHS = {
  M: [
    [1, 0, 0, 0, 0, 0, 1],
    [1, 1, 0, 0, 0, 1, 1],
    [1, 1, 0, 0, 0, 1, 1],
    [1, 0, 1, 0, 1, 0, 1],
    [1, 0, 1, 0, 1, 0, 1],
    [1, 0, 0, 1, 0, 0, 1],
    [1, 0, 0, 0, 0, 0, 1],
  ],
  F: [
    [1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1],
    [1, 0, 0, 0, 0, 0, 0],
    [1, 1, 1, 1, 1, 1, 0],
    [1, 1, 1, 1, 1, 1, 0],
    [1, 0, 0, 0, 0, 0, 0],
    [1, 0, 0, 0, 0, 0, 0],
  ],
  Y: [
    [1, 0, 0, 0, 1],
    [0, 1, 0, 1, 0],
    [0, 0, 1, 0, 0],
    [0, 0, 1, 0, 0],
    [0, 0, 1, 0, 0],
    [0, 0, 1, 0, 0],
    [0, 0, 1, 0, 0],
  ],
  DASH: [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
    [1, 1, 1],
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ],
};

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
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    Buffer.from(rgb.buffer, y * width * 3, width * 3).copy(raw, y * (width * 3 + 1) + 1);
  }
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function newCanvas(width, height) {
  const pixels = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    pixels[i * 3] = BG[0];
    pixels[i * 3 + 1] = BG[1];
    pixels[i * 3 + 2] = BG[2];
  }
  return { width, height, pixels };
}

function drawGlyph(canvas, glyph, startX, startY, pixel) {
  for (let row = 0; row < glyph.length; row++) {
    for (let col = 0; col < glyph[row].length; col++) {
      if (!glyph[row][col]) continue;
      for (let dy = 0; dy < pixel; dy++) {
        for (let dx = 0; dx < pixel; dx++) {
          const x = startX + col * pixel + dx;
          const y = startY + row * pixel + dy;
          if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) continue;
          const idx = (y * canvas.width + x) * 3;
          canvas.pixels[idx] = FG[0];
          canvas.pixels[idx + 1] = FG[1];
          canvas.pixels[idx + 2] = FG[2];
        }
      }
    }
  }
}

// Feature graphic 1024×500: "MF" grande à esquerda, "M-F" menor à direita.
const W = 1024;
const H = 500;
const canvas = newCanvas(W, H);

// Monograma grande (centro-esquerda): 7×16 units → pixel 22
const bigPixel = 22;
const bigW = (7 * 2 + 2) * bigPixel;
const bigH = 7 * bigPixel;
const bigX = Math.floor(W * 0.32 - bigW / 2);
const bigY = Math.floor((H - bigH) / 2);
drawGlyph(canvas, GLYPHS.M, bigX, bigY, bigPixel);
drawGlyph(canvas, GLYPHS.F, bigX + (7 + 2) * bigPixel, bigY, bigPixel);

// Wordmark "M-F" à direita: pixel 10 (menor, mais espaço de respiro).
const smallPixel = 10;
const sw = (7 + 3 + 3 + 7) * smallPixel;
const sh = 7 * smallPixel;
const sx = Math.floor(W * 0.7 - sw / 2);
const sy = Math.floor((H - sh) / 2);
drawGlyph(canvas, GLYPHS.M, sx, sy, smallPixel);
drawGlyph(canvas, GLYPHS.DASH, sx + (7 + 1) * smallPixel, sy, smallPixel);
drawGlyph(canvas, GLYPHS.F, sx + (7 + 3 + 3) * smallPixel, sy, smallPixel);

const outDir = new URL("../store-assets/play/", import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}feature-graphic-1024x500.png`, encodePng(W, H, canvas.pixels));
console.log("Feature graphic gerado: store-assets/play/feature-graphic-1024x500.png");
