import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  buildCategoryKeys,
  maskSensitive,
  resolveSuggestions,
  type AiCandidate,
  type AiCategoryOption,
} from "./ai-categorizer";

describe("maskSensitive", () => {
  it("mascara números longos (conta, cartão, CPF, CNPJ)", () => {
    expect(maskSensitive("PIX ENVIADO CPF 123.456.789-00")).toBe("PIX ENVIADO CPF ########");
    expect(maskSensitive("TED AG 0001 CC 12345-6")).toBe("TED AG 0001 CC ######");
    expect(maskSensitive("CARTAO 5502 0912 3456 7890")).toBe("CARTAO ########");
  });

  it("mascara e-mails", () => {
    expect(maskSensitive("PIX PARA fulano.silva@gmail.com")).toBe("PIX PARA [EMAIL]");
  });

  it("preserva números curtos que ajudam a identificar o estabelecimento", () => {
    expect(maskSensitive("POSTO 1234 IPIRANGA")).toBe("POSTO 1234 IPIRANGA");
    expect(maskSensitive("PARCELA 3/10")).toBe("PARCELA 3/10");
  });
});

describe("resolveSuggestions", () => {
  const categories: AiCategoryOption[] = [
    { id: "cat-mercado", name: "Mercado", type: "EXPENSE" },
    { id: "cat-salario", name: "Salário", type: "INCOME" },
  ];
  const keys = buildCategoryKeys(categories); // c1 = Mercado, c2 = Salário

  const batch: AiCandidate[] = [
    { id: "t0", date: new Date("2026-10-01"), amount: new Decimal("-120.50"), description: "SUPERMERCADO X" },
    { id: "t1", date: new Date("2026-10-05"), amount: new Decimal("5000"), description: "EMPREGADOR SA" },
    { id: "t2", date: new Date("2026-10-06"), amount: new Decimal("-80"), description: "PIX FULANO" },
  ];

  it("aplica confiança alta e média com categoria compatível com o sinal", () => {
    const result = resolveSuggestions(
      {
        results: [
          { ref: 0, category: "c1", confidence: "HIGH" },
          { ref: 1, category: "c2", confidence: "MEDIUM" },
        ],
      },
      batch,
      keys,
    );
    expect(result).toEqual([
      { transactionId: "t0", categoryId: "cat-mercado" },
      { transactionId: "t1", categoryId: "cat-salario" },
    ]);
  });

  it("deixa para revisão: confiança baixa, categoria nula e tipo incompatível", () => {
    const result = resolveSuggestions(
      {
        results: [
          { ref: 0, category: "c1", confidence: "LOW" },
          { ref: 1, category: "c1", confidence: "HIGH" }, // crédito em categoria de despesa
          { ref: 2, category: null, confidence: "MEDIUM" },
        ],
      },
      batch,
      keys,
    );
    expect(result).toEqual([]);
  });

  it("ignora refs fora do lote, chaves desconhecidas e refs repetidas", () => {
    const result = resolveSuggestions(
      {
        results: [
          { ref: 7, category: "c1", confidence: "HIGH" },
          { ref: 0, category: "c9", confidence: "HIGH" },
          { ref: 2, category: "c1", confidence: "HIGH" },
          { ref: 2, category: "c1", confidence: "HIGH" },
        ],
      },
      batch,
      keys,
    );
    expect(result).toEqual([{ transactionId: "t2", categoryId: "cat-mercado" }]);
  });
});
