import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { computeReconciliationHash, normalizeDescription } from "./reconciliation";

describe("normalizeDescription", () => {
  it("remove acentos, sobe para maiúsculas e colapsa espaços", () => {
    expect(normalizeDescription("  Pagamento   Açúcar é  ")).toBe("PAGAMENTO ACUCAR E");
  });

  it("é idempotente", () => {
    const once = normalizeDescription("Crédito Tédio");
    expect(normalizeDescription(once)).toBe(once);
  });
});

describe("computeReconciliationHash", () => {
  const base = {
    accountId: "00000000-0000-0000-0000-000000000001",
    date: new Date(Date.UTC(2024, 0, 5, 12, 0, 0)),
    amount: new Decimal("-150.00"),
    description: "Padaria do Zé",
    fitId: "abc123",
  };

  it("é determinístico: mesmos inputs → mesmo hash", () => {
    expect(computeReconciliationHash(base)).toBe(computeReconciliationHash({ ...base }));
  });

  it("usa apenas a data (dia), não o horário", () => {
    const morning = computeReconciliationHash(base);
    const evening = computeReconciliationHash({
      ...base,
      date: new Date(Date.UTC(2024, 0, 5, 23, 59, 59)),
    });
    expect(morning).toBe(evening);
  });

  it("normaliza a descrição antes de hashear (acentos/caixa irrelevantes)", () => {
    const a = computeReconciliationHash(base);
    const b = computeReconciliationHash({ ...base, description: "PADARIA DO ZE" });
    expect(a).toBe(b);
  });

  it("muda quando qualquer componente muda", () => {
    const original = computeReconciliationHash(base);
    expect(
      computeReconciliationHash({ ...base, amount: new Decimal("-150.01") }),
    ).not.toBe(original);
    expect(
      computeReconciliationHash({ ...base, accountId: "00000000-0000-0000-0000-000000000002" }),
    ).not.toBe(original);
    expect(computeReconciliationHash({ ...base, fitId: "xyz" })).not.toBe(original);
    expect(
      computeReconciliationHash({ ...base, date: new Date(Date.UTC(2024, 0, 6)) }),
    ).not.toBe(original);
  });

  it("produz hex SHA-256 de 64 caracteres", () => {
    expect(computeReconciliationHash(base)).toMatch(/^[0-9a-f]{64}$/);
  });
});
