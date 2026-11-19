import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Piso de acessibilidade dos tokens: lê globals.css e calcula o contraste
 * WCAG 2.2 dos pares que o app usa, nos dois temas. Mudou a paleta e este
 * teste falhou? O par ficou ilegível; ajuste a luminosidade, não o teste.
 */
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf("\n}", start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([\w-]+):\s*(oklch\([^)]*\))/g)) out[m[1]] = m[2];
  return out;
}

function oklchToLinearRgb(value: string): [number, number, number] {
  const [l, c, h] = value
    .replace(/oklch\(|\)/g, "")
    .split("/")[0]
    .trim()
    .split(/\s+/)
    .map(Number);
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  return [
    clamp(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
    clamp(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
    clamp(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
  ];
}

const luminance = (v: string) => {
  const [r, g, b] = oklchToLinearRgb(v);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

function ratio(fg: string, bg: string): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT_PAIRS: Array<[string, string]> = [
  ["on-surface", "surface"],
  ["on-surface-variant", "surface"],
  ["on-surface-variant", "surface-container-low"],
  ["on-surface-variant", "surface-container-high"],
  ["muted-foreground", "card"],
  ["foreground", "card"],
  ["primary-foreground", "primary"],
  ["primary", "surface"],
  ["secondary-foreground", "secondary"],
  ["income", "surface"],
  ["income", "card"],
  ["expense", "surface"],
  ["expense", "card"],
  ["transfer", "surface"],
  ["warning", "surface"],
  ["income-on-container", "income-container"],
  ["expense-on-container", "expense-container"],
  ["warning-on-container", "warning-container"],
  ["destructive", "card"],
];

// Controles, ícones e anel de foco: 3:1.
const UI_PAIRS: Array<[string, string]> = [
  ["ring", "surface"],
  ["ring", "card"],
  ["outline", "surface"],
  ["input", "card"],
];

describe.each([":root", ".dark"])("contraste dos tokens em %s", (selector) => {
  const t = block(selector);

  it.each(TEXT_PAIRS)("texto %s sobre %s ≥ 4.5:1", (fg, bg) => {
    expect(t[fg], fg).toBeDefined();
    expect(t[bg], bg).toBeDefined();
    expect(ratio(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it.each(UI_PAIRS)("controle %s sobre %s ≥ 3:1", (fg, bg) => {
    expect(ratio(t[fg], t[bg])).toBeGreaterThanOrEqual(3);
  });
});
