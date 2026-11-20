import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { allocateSurplus } from "./allocator";
import { MAX_SUGGESTIONS, buildSuggestions, pickSuggestions, type SuggestionInput } from "./suggestions";

const d = (v: number) => new Decimal(v);

function input(over: Partial<SuggestionInput> = {}): SuggestionInput {
  const allocation = allocateSurplus({
    pool: d(800),
    monthlyEssential: d(2000),
    reserveBalance: d(2000),
    debts: [{ id: "cart", name: "Acordo do cartão", monthlyRatePct: 9.2, balance: d(3456) }],
    goals: [],
  });
  return { hasTransactions: true, contribution: 800, categorizedShare: 0.95, allocation, ...over };
}

describe("buildSuggestions", () => {
  it("sem transação não há o que sugerir", () => {
    expect(buildSuggestions(input({ hasTransactions: false }))).toEqual([]);
  });

  it("dado ruim vence tudo: só pede para categorizar, sem valor", () => {
    const s = buildSuggestions(input({ categorizedShare: 0.6 }));
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ id: "data:categorizar", impactMonthly: 0, href: "/review" });
    expect(s[0].detail).toMatch(/60%/);
  });

  it("sem meses completos, pede extrato", () => {
    const s = buildSuggestions(input({ contribution: null, allocation: null }));
    expect(s.map((x) => x.id)).toEqual(["data:meses"]);
  });

  it("sem sobra, a sugestão é cortar", () => {
    const s = buildSuggestions(input({ contribution: 0, allocation: null }));
    expect(s.map((x) => x.id)).toEqual(["alloc:sem-sobra"]);
  });

  it("dívida cara vira sugestão com o juro como motivo e o valor da fila", () => {
    const [s] = buildSuggestions(input());
    expect(s.id).toBe("alloc:divida:cart");
    expect(s.impactMonthly).toBe(800);
    expect(s.title).toMatch(/Ataque Acordo do cartão/);
    expect(s.detail).toMatch(/9,2% ao mês/);
    expect(s.href).toBe("/dividas");
  });

  it("nunca cita ativo, ticker ou rentabilidade prometida", () => {
    const livre = allocateSurplus({
      pool: d(500),
      monthlyEssential: d(1000),
      reserveBalance: d(20000),
      debts: [],
      goals: [],
    });
    const [s] = buildSuggestions(input({ allocation: livre }));
    expect(s.id).toBe("alloc:livre");
    expect(`${s.title} ${s.detail}`).not.toMatch(/[A-Z]{4}\d{1,2}\b|garant|certeza|rende \d/i);
    expect(s.detail).toMatch(/não indica ativos/);
  });
});

describe("pickSuggestions", () => {
  const many = Array.from({ length: 5 }, (_, i) => ({
    id: `s${i}`,
    title: `t${i}`,
    detail: "",
    impactMonthly: 10,
    href: "/",
    cta: "ok",
  }));

  it("limita a 3, na ordem", () => {
    expect(pickSuggestions(many, new Set()).map((s) => s.id)).toEqual(["s0", "s1", "s2"]);
    expect(MAX_SUGGESTIONS).toBe(3);
  });

  it("dispensada sai e a próxima da fila ocupa o lugar; não volta", () => {
    expect(pickSuggestions(many, new Set(["s1"])).map((s) => s.id)).toEqual(["s0", "s2", "s3"]);
  });
});
