import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { computeBudgetRule, recommendSplit, suggestCuts, type CategorySpend } from "./budget-rule";

const d = (value: string | number) => new Decimal(value);
const spend = (name: string, nature: CategorySpend["nature"], spent: string): CategorySpend => ({
  categoryId: name.toLowerCase(),
  name,
  nature,
  spent: d(spent),
});

describe("recommendSplit", () => {
  it("usa 50/30/20 quando as necessidades cabem em 50%", () => {
    expect(recommendSplit(0.45).split).toEqual({ need: 0.5, want: 0.3, savings: 0.2 });
    expect(recommendSplit(null).split).toEqual({ need: 0.5, want: 0.3, savings: 0.2 });
  });

  it("adapta para 60/20/20 e 70/20/10 conforme o peso das necessidades", () => {
    expect(recommendSplit(0.55).split).toEqual({ need: 0.6, want: 0.2, savings: 0.2 });
    expect(recommendSplit(0.65).split).toEqual({ need: 0.7, want: 0.2, savings: 0.1 });
    expect(recommendSplit(0.85).reason).toMatch(/renegociar/);
  });
});

describe("computeBudgetRule", () => {
  it("separa os baldes e soma exatamente a receita", () => {
    const result = computeBudgetRule(d("10000"), [
      spend("Moradia", "NEED", "3000"),
      spend("Mercado", "NEED", "1500"),
      spend("Lazer", "WANT", "2000"),
      spend("Previdência", "SAVINGS", "500"),
      spend("Sem categoria", null, "300"),
    ]);

    expect(result.split).toEqual({ need: 0.5, want: 0.3, savings: 0.2 });
    expect(result.needs.actual.toFixed(2)).toBe("4500.00");
    expect(result.wants.actual.toFixed(2)).toBe("2000.00");
    // Poupança = aporte (500) + sobra (10000 − 7300 = 2700).
    expect(result.savings.actual.toFixed(2)).toBe("3200.00");
    expect(result.unclassified.total.toFixed(2)).toBe("300.00");

    const total = result.needs.actual
      .plus(result.wants.actual)
      .plus(result.savings.actual)
      .plus(result.unclassified.total);
    expect(total.toFixed(2)).toBe("10000.00");
    expect(result.cuts.gap.toFixed(2)).toBe("0.00");
    expect(result.cuts.suggestions).toEqual([]);
  });

  it("sugere cortes em Desejos quando a poupança fica abaixo da meta", () => {
    const result = computeBudgetRule(d("5000"), [
      spend("Moradia", "NEED", "2400"),
      spend("Delivery", "WANT", "1200"),
      spend("Assinaturas", "WANT", "600"),
      spend("Compras", "WANT", "400"),
    ]);

    // Sobra = 400; meta de poupança = 1000 → faltam 600.
    expect(result.savings.actual.toFixed(2)).toBe("400.00");
    expect(result.savings.target.toFixed(2)).toBe("1000.00");
    expect(result.cuts.gap.toFixed(2)).toBe("600.00");
    expect(result.cuts.suggestions.map((s) => [s.name, s.cut.toFixed(2)])).toEqual([
      ["Delivery", "327.27"],
      ["Assinaturas", "163.64"],
      ["Compras", "109.09"],
    ]);
    expect(result.cuts.uncovered.toFixed(2)).toBe("0.00");
  });

  it("mês no vermelho deixa a poupança negativa", () => {
    const result = computeBudgetRule(d("3000"), [spend("Moradia", "NEED", "2500"), spend("Lazer", "WANT", "800")]);
    expect(result.savings.actual.toFixed(2)).toBe("-300.00");
    // Necessidades em 83% → método 70/20/10, meta de poupança 300 → gap 600.
    expect(result.split).toEqual({ need: 0.7, want: 0.2, savings: 0.1 });
    expect(result.cuts.gap.toFixed(2)).toBe("600.00");
  });

  it("sem receita, as frações ficam nulas", () => {
    const result = computeBudgetRule(d("0"), [spend("Moradia", "NEED", "100")]);
    expect(result.needs.actualShare).toBeNull();
    expect(result.savings.actual.toFixed(2)).toBe("-100.00");
  });
});

describe("suggestCuts", () => {
  it("a soma dos cortes bate exatamente com o gap (sem sobra de centavos)", () => {
    const wants = [spend("A", "WANT", "100"), spend("B", "WANT", "100"), spend("C", "WANT", "100")];
    const { suggestions, uncovered } = suggestCuts(d("100"), wants);
    const total = suggestions.reduce((sum, s) => sum.plus(s.cut), d(0));
    expect(total.toFixed(2)).toBe("100.00");
    expect(uncovered.toFixed(2)).toBe("0.00");
  });

  it("nunca corta mais do que a categoria gastou e reporta o que não dá para cobrir", () => {
    const { suggestions, uncovered } = suggestCuts(d("500"), [spend("Lazer", "WANT", "200")]);
    expect(suggestions.map((s) => s.cut.toFixed(2))).toEqual(["200.00"]);
    expect(uncovered.toFixed(2)).toBe("300.00");
  });

  it("sem Desejos, todo o gap fica descoberto", () => {
    const { suggestions, uncovered } = suggestCuts(d("50"), []);
    expect(suggestions).toEqual([]);
    expect(uncovered.toFixed(2)).toBe("50.00");
  });
});
