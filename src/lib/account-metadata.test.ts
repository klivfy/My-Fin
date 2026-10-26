import { describe, expect, it } from "vitest";
import { invoiceCycleOf, parseAccountMetadata } from "./account-metadata";

describe("parseAccountMetadata", () => {
  it("retorna vazio para metadata ausente/não-objeto", () => {
    expect(parseAccountMetadata(null)).toEqual({});
    expect(parseAccountMetadata(undefined)).toEqual({});
    expect(parseAccountMetadata("string")).toEqual({});
  });

  it("aceita metadata válido", () => {
    expect(
      parseAccountMetadata({ creditLimit: "5000.00", closingDay: 10, dueDay: 20 }),
    ).toEqual({ creditLimit: "5000.00", closingDay: 10, dueDay: 20 });
  });

  it("rejeita metadata inválido sem lançar (degrada para {})", () => {
    expect(parseAccountMetadata({ closingDay: 99 })).toEqual({});
    expect(parseAccountMetadata({ creditLimit: "abc" })).toEqual({});
  });
});

describe("invoiceCycleOf", () => {
  it("usa defaults quando metadata não define o ciclo", () => {
    expect(invoiceCycleOf({})).toEqual({ closingDay: 25, dueDay: 5 });
  });

  it("respeita ciclo customizado do cartão", () => {
    expect(invoiceCycleOf({ closingDay: 10, dueDay: 17 })).toEqual({ closingDay: 10, dueDay: 17 });
  });
});
