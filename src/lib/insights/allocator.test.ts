import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { allocateSurplus, type AllocInput } from "./allocator";

const d = (v: string | number) => new Decimal(v);

const base: AllocInput = {
  pool: d(800),
  monthlyEssential: d(2000),
  reserveBalance: d(0),
  debts: [
    { id: "cel", name: "Celular", monthlyRatePct: 6, balance: d(416) },
    { id: "cart", name: "Acordo do cartão", monthlyRatePct: 9.2, balance: d(3456) },
  ],
  goals: [{ id: "viagem", name: "Viagem", remaining: d(5000) }],
};

const sumSteps = (a: ReturnType<typeof allocateSurplus>) => a.steps.reduce((acc, s) => acc.plus(s.amount), d(0));

describe("allocateSurplus", () => {
  it("sem reserva, a sobra toda vai primeiro para a reserva mínima", () => {
    const a = allocateSurplus(base);
    expect(a.steps).toHaveLength(1);
    expect(a.steps[0]).toMatchObject({ kind: "RESERVA_MINIMA" });
    expect(a.steps[0].amount.toNumber()).toBe(800);
  });

  it("com a reserva mínima feita, a dívida mais cara vem antes (avalanche) e antes da reserva completa", () => {
    const a = allocateSurplus({ ...base, reserveBalance: d(2000) });
    expect(a.steps.map((s) => s.id)).toEqual(["alloc:divida:cart"]);
    expect(a.steps[0].amount.toNumber()).toBe(800);
  });

  it("quando a sobra quita a primeira dívida, o resto cai na seguinte", () => {
    const a = allocateSurplus({ ...base, pool: d(3600), reserveBalance: d(2000) });
    expect(a.steps.map((s) => [s.id, s.amount.toNumber()])).toEqual([
      ["alloc:divida:cart", 3456],
      ["alloc:divida:cel", 144],
    ]);
  });

  it("sem dívida cara e com reserva mínima, completa a reserva e só depois vai para metas e livre", () => {
    const a = allocateSurplus({
      ...base,
      pool: d(20000),
      reserveBalance: d(2000),
      debts: [],
    });
    expect(a.steps.map((s) => s.kind)).toEqual(["RESERVA_COMPLETA", "META", "LIVRE"]);
    expect(a.steps[0].amount.toNumber()).toBe(10000); // 12.000 da reserva completa menos 2.000 já guardados
    expect(a.steps[1].amount.toNumber()).toBe(5000);
    expect(a.totals.free.toNumber()).toBe(5000);
  });

  it("dívida barata (até 1% a.m.) fica depois da reserva completa", () => {
    const a = allocateSurplus({
      ...base,
      pool: d(15000),
      reserveBalance: d(2000),
      debts: [{ id: "fin", name: "Financiamento", monthlyRatePct: 0.8, balance: d(1000) }],
      goals: [],
    });
    expect(a.steps.map((s) => s.id)).toEqual(["alloc:reserva-completa", "alloc:divida:fin", "alloc:livre"]);
  });

  it("a soma dos passos fecha exatamente a sobra, em qualquer cenário", () => {
    for (const pool of [0, 1, 50, 800, 3600, 12345.67, 100000]) {
      for (const reserveBalance of [0, 2000, 12000, 50000]) {
        const a = allocateSurplus({ ...base, pool: d(pool), reserveBalance: d(reserveBalance) });
        expect(sumSteps(a).toFixed(2)).toBe(d(pool).toFixed(2));
      }
    }
  });

  it("sobra zero ou negativa não gera passo", () => {
    expect(allocateSurplus({ ...base, pool: d(0) }).steps).toEqual([]);
    expect(allocateSurplus({ ...base, pool: d(-300) }).steps).toEqual([]);
  });

  it("totais por tipo batem com os passos", () => {
    const a = allocateSurplus({ ...base, pool: d(20000), reserveBalance: d(2000) });
    expect(a.totals.reserve.plus(a.totals.debts).plus(a.totals.goals).plus(a.totals.free).toFixed(2)).toBe("20000.00");
    expect(a.totals.debts.toNumber()).toBe(3872);
  });
});
