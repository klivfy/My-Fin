import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { decimalToDb, moneySchema, toDecimal } from "./money";

describe("toDecimal", () => {
  it("aceita string, number e Decimal", () => {
    expect(toDecimal("10.50").toFixed(2)).toBe("10.50");
    expect(toDecimal(10.5).toFixed(2)).toBe("10.50");
    expect(toDecimal(new Decimal("10.5")).toFixed(2)).toBe("10.50");
  });
});

describe("moneySchema", () => {
  it("aceita formato internacional com ponto", () => {
    const result = moneySchema.parse("1234.56");
    expect(result).toBeInstanceOf(Decimal);
    expect(result.toFixed(2)).toBe("1234.56");
  });

  it("aceita formato BR com vírgula e separador de milhar", () => {
    expect(moneySchema.parse("1.234,56").toFixed(2)).toBe("1234.56");
    expect(moneySchema.parse("10,50").toFixed(2)).toBe("10.50");
  });

  it("aceita number", () => {
    expect(moneySchema.parse(42).toFixed(2)).toBe("42.00");
  });

  it("rejeita valores não numéricos e não finitos", () => {
    expect(() => moneySchema.parse("abc")).toThrow();
    expect(() => moneySchema.parse("NaN")).toThrow();
    expect(() => moneySchema.parse("Infinity")).toThrow();
  });
});

describe("decimalToDb", () => {
  it("serializa com exatamente 2 casas", () => {
    expect(decimalToDb(new Decimal("10"))).toBe("10.00");
    expect(decimalToDb(new Decimal("-0.1"))).toBe("-0.10");
    expect(decimalToDb(new Decimal("10.555"))).toBe("10.56");
  });
});
