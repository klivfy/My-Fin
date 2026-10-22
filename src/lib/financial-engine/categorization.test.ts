import { describe, expect, it } from "vitest";
import { matchCategory, normalizeRulePattern } from "./categorization";

describe("normalizeRulePattern", () => {
  it("normaliza como a descrição (maiúsculas, sem acento, espaços colapsados)", () => {
    expect(normalizeRulePattern("  padaria   são  joão ")).toBe("PADARIA SAO JOAO");
  });

  it("rejeita trechos curtos demais para discriminar", () => {
    expect(normalizeRulePattern("pix")).toBeNull();
    expect(normalizeRulePattern("   ")).toBeNull();
  });
});

describe("matchCategory", () => {
  const rules = [
    { pattern: "IFOOD", categoryId: "delivery" },
    { pattern: "UBER", categoryId: "transporte" },
    { pattern: "UBER EATS", categoryId: "delivery" },
  ];

  it("casa por substring na descrição normalizada", () => {
    expect(matchCategory("Compra iFood *Restaurante", rules)).toBe("delivery");
  });

  it("prefere o padrão mais longo (mais específico)", () => {
    expect(matchCategory("UBER EATS PEDIDO 123", rules)).toBe("delivery");
    expect(matchCategory("UBER TRIP SAO PAULO", rules)).toBe("transporte");
  });

  it("não depende da ordem das regras", () => {
    expect(matchCategory("UBER EATS PEDIDO", [...rules].reverse())).toBe("delivery");
  });

  it("desempata padrões de mesmo tamanho de forma determinística", () => {
    const tied = [
      { pattern: "LOJA B", categoryId: "b" },
      { pattern: "LOJA A", categoryId: "a" },
    ];
    expect(matchCategory("LOJA A LOJA B", tied)).toBe("a");
    expect(matchCategory("LOJA A LOJA B", [...tied].reverse())).toBe("a");
  });

  it("retorna null quando nenhuma regra casa", () => {
    expect(matchCategory("PIX RECEBIDO FULANO", rules)).toBeNull();
    expect(matchCategory("QUALQUER", [])).toBeNull();
  });
});
