import { describe, expect, it } from "vitest";
import { applyRules, matchCategory } from "./category-rules";

const RULES = [
  { pattern: "Netflix", categoryId: "cat-streaming" },
  { pattern: "IFOOD", categoryId: "cat-alimentacao" },
  { pattern: "posto", categoryId: "cat-transporte" },
];

describe("applyRules", () => {
  it("atribui a primeira regra que casa (ordem = precedência)", () => {
    const result = applyRules(
      [
        { id: "t1", description: "IFOOD *NETFLIX PROMO" },
        { id: "t2", description: "Posto Ipiranga" },
        { id: "t3", description: "Salário" },
      ],
      RULES,
    );
    expect(result.get("t1")).toBe("cat-streaming"); // Netflix vem antes do IFOOD na lista
    expect(result.get("t2")).toBe("cat-transporte");
    expect(result.has("t3")).toBe(false);
  });

  it("é case/accent-insensitive (normaliza os dois lados)", () => {
    const result = applyRules(
      [{ id: "t1", description: "pagamento açúcar é" }],
      [{ pattern: "ACUCAR E", categoryId: "cat-x" }],
    );
    expect(result.get("t1")).toBe("cat-x");
  });

  it("ignora regras com padrão vazio", () => {
    const result = applyRules(
      [{ id: "t1", description: "qualquer" }],
      [{ pattern: "   ", categoryId: "cat-x" }],
    );
    expect(result.size).toBe(0);
  });
});

describe("matchCategory", () => {
  it("retorna a categoria do primeiro padrão encontrado", () => {
    expect(matchCategory("NETFLIX.COM", RULES)).toBe("cat-streaming");
    expect(matchCategory("sem match", RULES)).toBeNull();
  });
});
