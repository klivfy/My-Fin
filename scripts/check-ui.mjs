// Trava de interface (regras do DESIGN.md). Roda no CI: `npm run check:ui`.
// Para liberar uma linha de propósito, ponha `ui-check-ignore: motivo` na linha ou na anterior.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const root = new URL("../src", import.meta.url).pathname;
const RULES = [
  { re: /text-\[(\d+(?:\.\d+)?)px\]/, bad: (m) => Number(m[1]) < 12, msg: "texto abaixo de 12px; use text-xs ou maior" },
  { re: /#[0-9a-fA-F]{3,8}\b/, msg: "cor fixa; use token de globals.css" },
  { re: /\b(?:window\.)?confirm\s*\(/, msg: "confirm() nativo; use ConfirmDialog" },
  { re: /\bdark:/, msg: "tema escuro é proibido (DESIGN.md)" },
];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (p.endsWith(".tsx")) yield p;
  }
}

let failures = 0;
for (const file of walk(root)) {
  const rel = relative(root, file);
  if (rel.startsWith(`components${sep}ui${sep}`)) continue; // primitivos shadcn
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (line.includes("ui-check-ignore") || (lines[i - 1] ?? "").includes("ui-check-ignore")) return;
    for (const rule of RULES) {
      const m = line.match(rule.re);
      if (m && (!rule.bad || rule.bad(m))) {
        console.error(`src/${rel}:${i + 1}: ${rule.msg}\n  ${line.trim()}`);
        failures++;
      }
    }
  });
}
if (failures) {
  console.error(`\n${failures} violação(ões) das regras de interface.`);
  process.exit(1);
}
console.log("check:ui ok");
