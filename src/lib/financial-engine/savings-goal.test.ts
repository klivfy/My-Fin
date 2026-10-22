import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  dateOfMonthIndex,
  monthIndexOf,
  planGoal,
  suggestContribution,
  suggestEmergencyFund,
  summarizeSurplus,
  type MonthTotals,
} from "./savings-goal";

const d = (v: string | number) => new Decimal(v);
const NOW = new Date(Date.UTC(2026, 9, 22)); // 22/out/2026
const m = (year: number, month1: number) => year * 12 + (month1 - 1);

function totals(month: number, income: string, expense: string, need = "0"): MonthTotals {
  return { month, income: d(income), expense: d(expense), needExpense: d(need) };
}

describe("summarizeSurplus", () => {
  it("usa os últimos 3 meses completos, sem o primeiro mês (parcial) nem o corrente", () => {
    const summary = summarizeSurplus(
      [
        totals(m(2026, 5), "0", "900"), // primeiro mês: extrato começou no meio
        totals(m(2026, 6), "7000", "5000", "3000"),
        totals(m(2026, 7), "7000", "6000", "3200"),
        totals(m(2026, 8), "7000", "5500", "3100"),
        totals(m(2026, 9), "7000", "4600", "2900"),
        totals(m(2026, 10), "7000", "1000"), // mês corrente
      ],
      NOW,
    )!;
    expect(summary.months).toEqual([m(2026, 7), m(2026, 8), m(2026, 9)]);
    expect(summary.averageSurplus.toFixed(2)).toBe("1633.33"); // (1000 + 1500 + 2400) / 3
    expect(summary.worstSurplus.toFixed(2)).toBe("1000.00");
    expect(summary.averageNeedExpense.toFixed(2)).toBe("3066.67");
  });

  it("sem mês completo aproveitável retorna null", () => {
    expect(summarizeSurplus([], NOW)).toBeNull();
    expect(summarizeSurplus([totals(m(2026, 9), "1", "1"), totals(m(2026, 10), "1", "1")], NOW)).toBeNull();
  });
});

describe("suggestEmergencyFund", () => {
  const base = { months: [], averageSurplus: d(0), worstSurplus: d(0), averageExpense: d("5012.40") };

  it("6× o custo de Necessidades, arredondado para cima em centenas", () => {
    const result = suggestEmergencyFund({ ...base, averageNeedExpense: d("3066.67") });
    // 3066,67 × 6 = 18.400,02 → arredonda para cima: 18.500.
    expect(result).toEqual({ amount: d("18500"), basedOn: "NEED" });
  });

  it("sem naturezas definidas, usa o gasto total", () => {
    const result = suggestEmergencyFund({ ...base, averageNeedExpense: d(0) });
    expect(result.amount.toFixed(0)).toBe("30100");
    expect(result.basedOn).toBe("TOTAL");
  });
});

describe("suggestContribution", () => {
  it("80% da sobra, para baixo em R$ 10", () => {
    expect(suggestContribution(d("1633.33")).toFixed(2)).toBe("1300.00");
  });
  it("sem sobra, nenhum aporte", () => {
    expect(suggestContribution(d("-200")).isZero()).toBe(true);
    expect(suggestContribution(d("0")).isZero()).toBe(true);
  });
});

describe("planGoal", () => {
  it("marcos de 25/50/75/100% com mês previsto no ritmo do aporte", () => {
    const plan = planGoal({ target: d("10000"), saved: d("3000"), contribution: d("1000"), targetDate: null, now: NOW });
    expect(plan.progress).toBeCloseTo(0.3);
    expect(plan.status).toBe("NO_DEADLINE");
    expect(plan.monthsToGoal).toBe(7);
    expect(plan.milestones.map((ms) => [ms.fraction, ms.reached, ms.projectedMonth])).toEqual([
      [0.25, true, null],
      [0.5, false, monthIndexOf(NOW) + 2],
      [0.75, false, monthIndexOf(NOW) + 5],
      [1, false, monthIndexOf(NOW) + 7],
    ]);
    expect(dateOfMonthIndex(plan.projectedMonth!).toISOString().slice(0, 7)).toBe("2027-05");
  });

  it("com data-alvo: no prazo quando o aporte cobre o necessário", () => {
    const plan = planGoal({
      target: d("6000"),
      saved: d("0"),
      contribution: d("1000"),
      targetDate: new Date(Date.UTC(2027, 5, 1)), // jun/27 → 8 meses
      now: NOW,
    });
    expect(plan.requiredMonthly!.toFixed(2)).toBe("750.00");
    expect(plan.status).toBe("ON_TRACK");
  });

  it("com data-alvo apertada: em risco, informando o aporte necessário", () => {
    const plan = planGoal({
      target: d("6000"),
      saved: d("0"),
      contribution: d("500"),
      targetDate: new Date(Date.UTC(2027, 0, 1)), // jan/27 → 3 meses
      now: NOW,
    });
    expect(plan.requiredMonthly!.toFixed(2)).toBe("2000.00");
    expect(plan.status).toBe("AT_RISK");
  });

  it("sem sobra não projeta datas", () => {
    const plan = planGoal({ target: d("5000"), saved: d("0"), contribution: d("0"), targetDate: null, now: NOW });
    expect(plan.status).toBe("NO_SURPLUS");
    expect(plan.monthsToGoal).toBeNull();
    expect(plan.milestones.every((ms) => ms.projectedMonth === null)).toBe(true);
  });

  it("meta atingida (e saldo negativo é tratado como zero)", () => {
    expect(planGoal({ target: d("1000"), saved: d("1200"), contribution: d("0"), targetDate: null, now: NOW }).status).toBe(
      "DONE",
    );
    expect(planGoal({ target: d("1000"), saved: d("-50"), contribution: d("100"), targetDate: null, now: NOW }).saved.toFixed(2)).toBe(
      "0.00",
    );
  });
});
