import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  POT_ORDER,
  computePots,
  defaultPercents,
  resolvePot,
  splitAmount,
  validatePercents,
  type Percents,
  type Pot,
} from "./pots";

const d = (v: string | number) => new Decimal(v);
const sum = (r: Record<Pot, Decimal>) => POT_ORDER.reduce((a, p) => a.plus(r[p]), d(0));

describe("splitAmount", () => {
  it("salário de R$ 3.000 no padrão 50/10/10/10/10/10 (exemplo do método)", () => {
    const r = splitAmount(d(3000), defaultPercents());
    expect(r.NECESSIDADES.toNumber()).toBe(1500);
    expect(r.LIBERDADE.toNumber()).toBe(300);
    expect(r.DIVERSAO.toNumber()).toBe(300);
    expect(sum(r).toNumber()).toBe(3000);
  });

  it("nunca perde nem cria centavo, mesmo com percentuais quebrados", () => {
    const p = defaultPercents();
    p.NECESSIDADES = d("33.33");
    p.LIBERDADE = d("33.33");
    p.LONGO_PRAZO = d("33.34");
    p.INSTRUCAO = d(0);
    p.DOACOES = d(0);
    p.DIVERSAO = d(0);
    for (const amount of ["0.01", "1", "100.01", "999.99", "3000.37"]) {
      expect(sum(splitAmount(d(amount), p)).toFixed(2)).toBe(d(amount).toFixed(2));
    }
  });

  it("R$ 1 (o 'nem que seja 1 real' do método) fecha em R$ 1,00", () => {
    const r = splitAmount(d(1), defaultPercents());
    expect(sum(r).toNumber()).toBe(1);
    expect(r.NECESSIDADES.toNumber()).toBe(0.5);
  });
});

describe("validatePercents", () => {
  it("aceita o padrão e recusa soma diferente de 100", () => {
    expect(validatePercents(defaultPercents())).toBeNull();
    const p: Percents = { ...defaultPercents(), DIVERSAO: d(20) };
    expect(validatePercents(p)).toMatch(/110/);
  });

  it("recusa negativo e acima de 100", () => {
    expect(validatePercents({ ...defaultPercents(), DOACOES: d(-5) })).toMatch(/Doações/);
    expect(validatePercents({ ...defaultPercents(), DOACOES: d(101) })).toMatch(/Doações/);
  });
});

describe("resolvePot", () => {
  it("pote explícito vence a natureza; sem pote, deriva dela", () => {
    expect(resolvePot("NEED", "DOACOES")).toBe("DOACOES");
    expect(resolvePot("NEED", null)).toBe("NECESSIDADES");
    expect(resolvePot("WANT", null)).toBe("DIVERSAO");
    expect(resolvePot("SAVINGS", null)).toBe("LIBERDADE");
    expect(resolvePot(null, null)).toBeNull();
  });
});

describe("computePots", () => {
  const spends = [
    { pot: "NECESSIDADES" as const, spent: d(1700) },
    { pot: "DIVERSAO" as const, spent: d(120) },
    { pot: "LIBERDADE" as const, spent: d(300) },
    { pot: null, spent: d(80) },
  ];

  it("teto estourado em pote de gasto chama atenção; sobra mostra o que cabe", () => {
    const r = computePots(d(3000), spends, defaultPercents());
    const need = r.lines.find((l) => l.pot === "NECESSIDADES")!;
    expect(need.target.toNumber()).toBe(1500);
    expect(need.attention).toBe(true);
    expect(need.remaining.toNumber()).toBe(0);
    const fun = r.lines.find((l) => l.pot === "DIVERSAO")!;
    expect(fun.attention).toBe(false);
    expect(fun.remaining.toNumber()).toBe(180);
  });

  it("pote de guardar abaixo da meta chama atenção; bateu a meta não", () => {
    const r = computePots(d(3000), spends, defaultPercents());
    expect(r.lines.find((l) => l.pot === "LIBERDADE")!.attention).toBe(false);
    const lp = r.lines.find((l) => l.pot === "LONGO_PRAZO")!;
    expect(lp.attention).toBe(true);
    expect(lp.remaining.toNumber()).toBe(300);
  });

  it("despesa sem pote não é chutada: fica em não atribuída", () => {
    expect(computePots(d(3000), spends, defaultPercents()).unassigned.toNumber()).toBe(80);
  });

  it("sem receita no período não há meta nem alerta de guardar", () => {
    const r = computePots(d(0), [], defaultPercents());
    expect(r.lines.every((l) => l.target.isZero() && !l.attention && l.usedShare === null)).toBe(true);
  });
});
