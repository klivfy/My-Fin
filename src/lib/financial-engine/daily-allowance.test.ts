import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { dailyAllowance } from "./daily-allowance";

const d = (v: number) => new Decimal(v);

describe("dailyAllowance", () => {
  it("sem contas a vencer é o que resta dividido pelos dias", () => {
    const r = dailyAllowance({ limit: d(600), spent: d(300), pendingBills: d(0), daysLeft: 10 });
    expect(r.perDay.toNumber()).toBe(30);
    expect(r.reserved.toNumber()).toBe(0);
  });

  it("desconta as contas que ainda vão vencer antes de dividir", () => {
    const r = dailyAllowance({ limit: d(600), spent: d(300), pendingBills: d(120), daysLeft: 10 });
    expect(r.reserved.toNumber()).toBe(120);
    expect(r.perDay.toNumber()).toBe(18);
  });

  it("contas maiores que o resto do teto zeram o dia a dia, sem ficar negativo", () => {
    const r = dailyAllowance({ limit: d(600), spent: d(550), pendingBills: d(200), daysLeft: 5 });
    expect(r.reserved.toNumber()).toBe(50);
    expect(r.perDay.toNumber()).toBe(0);
  });

  it("teto estourado não gera folga", () => {
    const r = dailyAllowance({ limit: d(100), spent: d(150), pendingBills: d(30), daysLeft: 3 });
    expect(r.perDay.toNumber()).toBe(0);
    expect(r.reserved.toNumber()).toBe(0);
  });

  it("arredonda para baixo em centavos e aceita daysLeft 1", () => {
    expect(dailyAllowance({ limit: d(100), spent: d(0), pendingBills: d(0), daysLeft: 3 }).perDay.toNumber()).toBe(33.33);
    expect(dailyAllowance({ limit: d(100), spent: d(40), pendingBills: d(0), daysLeft: 1 }).perDay.toNumber()).toBe(60);
  });
});
