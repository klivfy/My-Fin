import { describe, expect, it } from "vitest";
import { bridgeSuggestions, mergeSuggestions, type BridgeInput } from "./bridges";
import type { Suggestion } from "./suggestions";

const base: BridgeInput = {
  overdueInvoices: null,
  subscriptions: null,
  avgIncome: 5000,
  expensiveDebt: null,
  trading: null,
  averageSurplus: 1000,
  reserveBalance: 6000,
  investmentBalance: 0,
  monthlyEssential: 2000,
};

const ids = (list: Suggestion[]) => list.map((s) => s.id);
const sug = (id: string): Suggestion => ({ id, title: id, detail: "", impactMonthly: 0, href: "/", cta: "ok" });

describe("ponte 2: fatura vencida", () => {
  it("vai na frente da fila e aponta para Dívidas", () => {
    const r = bridgeSuggestions({ ...base, overdueInvoices: { total: 1800, count: 1 } });
    expect(ids(r.leading)).toEqual(["card:fatura-vencida"]);
    expect(r.leading[0]).toMatchObject({ href: "/dividas" });
    expect(r.leading[0].title).toMatch(/1\.800/);
  });

  it("sem fatura vencida não diz nada", () => {
    expect(bridgeSuggestions(base).leading).toEqual([]);
    expect(bridgeSuggestions({ ...base, overdueInvoices: { total: 0, count: 0 } }).leading).toEqual([]);
  });
});

describe("ponte 3: assinaturas viram corte", () => {
  const subs = { monthly: 300, annual: 3600, top: [{ name: "Streaming", monthly: 80 }, { name: "Academia", monthly: 120 }] };

  it("sugere revisar quando passam de 3% da renda", () => {
    const r = bridgeSuggestions({ ...base, subscriptions: subs });
    expect(ids(r.cuts)).toEqual(["cut:assinaturas"]);
    expect(r.cuts[0].detail).toMatch(/6%/);
    expect(r.cuts[0].impactMonthly).toBe(300);
  });

  it("calada quando é pouco: abaixo de 3% da renda ou de R$ 50", () => {
    expect(bridgeSuggestions({ ...base, subscriptions: subs, avgIncome: 20000 }).cuts).toEqual([]);
    expect(bridgeSuggestions({ ...base, subscriptions: { ...subs, monthly: 40 }, avgIncome: 1000 }).cuts).toEqual([]);
  });

  it("sem renda média conhecida não compara", () => {
    expect(bridgeSuggestions({ ...base, subscriptions: subs, avgIncome: null }).cuts).toEqual([]);
  });
});

describe("ponte 6: trading com dívida cara", () => {
  const debt = { maxRatePct: 9.2, balance: 3456 };

  it("resultado negativo sobe para a frente da fila", () => {
    const r = bridgeSuggestions({ ...base, expensiveDebt: debt, trading: { closed: 12, net: -450, maxLossMonth: null } });
    expect(ids(r.leading)).toEqual(["trade:divida"]);
  });

  it("resultado positivo ainda avisa, mas no fim", () => {
    const r = bridgeSuggestions({ ...base, expensiveDebt: debt, trading: { closed: 12, net: 300, maxLossMonth: null } });
    expect(ids(r.trailing)).toEqual(["trade:divida"]);
    expect(r.leading).toEqual([]);
  });

  it("sem operação fechada ou com juro baixo não avisa", () => {
    expect(bridgeSuggestions({ ...base, expensiveDebt: debt, trading: { closed: 0, net: 0, maxLossMonth: null } }).trailing).toEqual([]);
    expect(
      bridgeSuggestions({ ...base, expensiveDebt: { maxRatePct: 0.8, balance: 900 }, trading: { closed: 5, net: -10, maxLossMonth: null } }).leading,
    ).toEqual([]);
  });
});

describe("ponte 7: limite de perda contra a sobra", () => {
  it("avisa quando o limite mensal passa da sobra média", () => {
    const r = bridgeSuggestions({ ...base, trading: { closed: 0, net: 0, maxLossMonth: 2500 } });
    expect(ids(r.trailing)).toEqual(["trade:limite-vs-sobra"]);
    expect(r.trailing[0].href).toBe("/trading/risco");
  });

  it("sobra negativa conta como zero", () => {
    const r = bridgeSuggestions({ ...base, averageSurplus: -300, trading: { closed: 0, net: 0, maxLossMonth: 100 } });
    expect(ids(r.trailing)).toEqual(["trade:limite-vs-sobra"]);
    expect(r.trailing[0].title).toMatch(/R\$\s0,00/);
  });

  it("limite dentro da sobra, não configurado ou sem sobra calculada fica quieto", () => {
    expect(bridgeSuggestions({ ...base, trading: { closed: 0, net: 0, maxLossMonth: 800 } }).trailing).toEqual([]);
    expect(bridgeSuggestions({ ...base, trading: { closed: 0, net: 0, maxLossMonth: null } }).trailing).toEqual([]);
    expect(bridgeSuggestions({ ...base, averageSurplus: null, trading: { closed: 0, net: 0, maxLossMonth: 5000 } }).trailing).toEqual([]);
  });
});

describe("ponte 8: renda variável não é reserva", () => {
  it("avisa quando há carteira relevante e a reserva líquida está abaixo de 6 meses", () => {
    const r = bridgeSuggestions({ ...base, reserveBalance: 3000, investmentBalance: 20000 });
    expect(ids(r.trailing)).toEqual(["reserva:renda-variavel"]);
    expect(r.trailing[0].detail).toMatch(/1,5 de 6 meses/);
  });

  it("quieto com reserva completa, sem carteira relevante ou sem custo essencial", () => {
    expect(bridgeSuggestions({ ...base, reserveBalance: 12000, investmentBalance: 20000 }).trailing).toEqual([]);
    expect(bridgeSuggestions({ ...base, reserveBalance: 0, investmentBalance: 500 }).trailing).toEqual([]);
    expect(bridgeSuggestions({ ...base, monthlyEssential: null, investmentBalance: 20000 }).trailing).toEqual([]);
  });
});

describe("mergeSuggestions", () => {
  const queue = [sug("alloc:a"), sug("alloc:b"), sug("alloc:c")];
  const bridges = { leading: [sug("lead")], cuts: [sug("cut")], trailing: [sug("tail")] };

  it("urgente, primeiro da fila, corte, resto da fila, avisos", () => {
    expect(ids(mergeSuggestions(queue, bridges))).toEqual(["lead", "alloc:a", "cut", "alloc:b", "alloc:c", "tail"]);
  });

  it("dado ruim fica sozinho", () => {
    expect(ids(mergeSuggestions([sug("data:categorizar")], bridges))).toEqual(["data:categorizar"]);
  });

  it("fila vazia ainda mostra as pontes", () => {
    expect(ids(mergeSuggestions([], bridges))).toEqual(["lead", "cut", "tail"]);
  });
});

describe("limites de linguagem", () => {
  it("nenhuma ponte cita ativo, ticker ou rentabilidade", () => {
    const all = bridgeSuggestions({
      overdueInvoices: { total: 900, count: 2 },
      subscriptions: { monthly: 400, annual: 4800, top: [{ name: "Streaming", monthly: 60 }] },
      avgIncome: 5000,
      expensiveDebt: { maxRatePct: 9, balance: 3000 },
      trading: { closed: 3, net: -100, maxLossMonth: 4000 },
      averageSurplus: 500,
      reserveBalance: 1000,
      investmentBalance: 9000,
      monthlyEssential: 2000,
    });
    const text = [...all.leading, ...all.cuts, ...all.trailing].map((s) => `${s.title} ${s.detail}`).join(" ");
    expect(text).not.toMatch(/\b[A-Z]{4}\d{1,2}\b/);
    expect(text).not.toMatch(/rentabilidade|recomend|compre|venda/i);
  });
});
