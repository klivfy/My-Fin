import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  attackOrder,
  comparePayoff,
  contractTotal,
  presentValue,
  simulatePayoff,
  type DebtInput,
} from "./debt-payoff";

const d = (v: string | number) => new Decimal(v);

// Exemplo didático de três dívidas (parcelas e juros médios de mercado).
const DEBTS: DebtInput[] = [
  { id: "celular", name: "Celular", installment: d(120), remaining: 4, monthlyRate: d("0.06") },
  { id: "emprestimo", name: "Empréstimo", installment: d(250), remaining: 10, monthlyRate: d("0.06") },
  { id: "cartao", name: "Acordo do cartão", installment: d(400), remaining: 18, monthlyRate: d("0.09") },
];

describe("presentValue", () => {
  it("é o saldo para quitar hoje (valor presente das parcelas)", () => {
    expect(presentValue(DEBTS[0]).toNumber()).toBeCloseTo(415.81, 2);
    const total = DEBTS.reduce((a, x) => a.plus(presentValue(x)), d(0));
    expect(total.toNumber()).toBeGreaterThan(5700);
    expect(total.toNumber()).toBeLessThan(5800);
  });

  it("sem juros é parcela vezes parcelas", () => {
    expect(presentValue({ installment: d(100), remaining: 3, monthlyRate: d(0) }).toNumber()).toBe(300);
  });
});

describe("attackOrder", () => {
  it("bola de neve vai da menor para a maior; avalanche do juro mais alto para o mais baixo", () => {
    expect(attackOrder(DEBTS, "bola-de-neve")).toEqual(["celular", "emprestimo", "cartao"]);
    expect(attackOrder(DEBTS, "avalanche")).toEqual(["cartao", "celular", "emprestimo"]);
    expect(attackOrder(DEBTS, "parcelas")).toEqual([]);
  });
});

describe("simulatePayoff", () => {
  it("só as parcelas: paga exatamente o contrato, no prazo", () => {
    const plan = simulatePayoff(DEBTS, "parcelas");
    expect(plan.totalPaid.toNumber()).toBe(contractTotal(DEBTS).toNumber());
    expect(plan.totalPaid.toNumber()).toBe(10180);
    expect(plan.months).toBe(18);
    expect(plan.payoffMonth).toEqual({ celular: 4, emprestimo: 10, cartao: 18 });
  });

  it("bola de neve: a parcela que acaba rola para a próxima e encurta o prazo sem dinheiro novo", () => {
    const plan = simulatePayoff(DEBTS, "bola-de-neve");
    expect(plan.payoffMonth.celular).toBe(4);
    expect(plan.payoffMonth.emprestimo).toBe(8);
    expect(plan.months).toBeLessThanOrEqual(13);
    expect(plan.totalPaid.toNumber()).toBeLessThan(9300);
    // Nunca paga mais por mês do que já pagava.
    for (const row of plan.schedule) expect(row.total.toNumber()).toBeLessThanOrEqual(770.01);
  });

  it("avalanche: mais barata que a bola de neve quando o juro mais alto está na maior dívida", () => {
    const snow = simulatePayoff(DEBTS, "bola-de-neve");
    const aval = simulatePayoff(DEBTS, "avalanche");
    expect(aval.totalPaid.lt(snow.totalPaid)).toBe(true);
    expect(aval.payoffMonth.emprestimo).toBe(10); // segue no prazo normal
    expect(aval.months).toBeLessThanOrEqual(12);
  });

  it("dinheiro extra vai para a primeira da fila desde o primeiro mês", () => {
    const plan = simulatePayoff(DEBTS, "bola-de-neve", d(100));
    expect(plan.months).toBe(10);
    expect(plan.schedule[0].payments[0].toNumber()).toBeGreaterThan(120);
  });

  it("extra não muda a linha de base do contrato", () => {
    expect(simulatePayoff(DEBTS, "parcelas", d(500)).totalPaid.toNumber()).toBe(10180);
  });

  it("juros pagos = total pago menos o saldo de hoje", () => {
    const plan = simulatePayoff(DEBTS, "avalanche");
    const today = DEBTS.reduce((a, x) => a.plus(presentValue(x)), d(0));
    expect(plan.interest.toNumber()).toBeCloseTo(plan.totalPaid.minus(today).toNumber(), 6);
  });

  it("dívida única sem juros acaba no prazo", () => {
    const plan = simulatePayoff([{ id: "a", name: "A", installment: d(50), remaining: 2, monthlyRate: d(0) }], "avalanche");
    expect(plan.months).toBe(2);
    expect(plan.totalPaid.toNumber()).toBe(100);
  });
});

describe("comparePayoff", () => {
  it("diz qual método é mais barato e quando cada um fecha a segunda dívida", () => {
    const c = comparePayoff(DEBTS);
    expect(c.cheaper).toBe("avalanche");
    expect(c.difference.toNumber()).toBeGreaterThan(0);
    expect(c.difference.toNumber()).toBeLessThan(200);
    expect(c.secondWin.snowball).toBe(8);
    expect(c.secondWin.avalanche).toBe(10);
    expect(c.contract.totalPaid.minus(c.snowball.totalPaid).toNumber()).toBeGreaterThan(800);
  });

  it("empate quando as dívidas têm o mesmo juro e a mesma ordem", () => {
    const same = DEBTS.map((x) => ({ ...x, monthlyRate: d("0.05") }));
    expect(comparePayoff(same).cheaper).toBe("empate");
  });
});
