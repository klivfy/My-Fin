import Decimal from "decimal.js";

/**
 * Plano de quitação de dívidas parceladas: "só as parcelas", bola de neve
 * (menor dívida primeiro) e avalanche (maior juro primeiro).
 *
 * Modelo:
 * - Cada dívida é um parcelamento de prestação fixa (tabela Price): `installment`
 *   por mês, `remaining` parcelas, juro mensal `monthlyRate`.
 * - O saldo de hoje é o valor presente das parcelas restantes. Adiantar parcelas
 *   reduz o saldo por esse valor presente, ou seja, com desconto dos juros
 *   proporcionais (CDC, art. 52, § 2º). Se o credor não der o desconto, a
 *   economia real é menor do que a simulada: a tela diz isso.
 * - O "mínimo" de cada dívida é a parcela inteira. Nada de pagar o mínimo do
 *   cartão (rotativo) para sobrar dinheiro: o mínimo não cobre os juros.
 * - Bola de neve e avalanche usam o mesmo orçamento mensal: soma das parcelas
 *   de hoje mais o `extra`. Quando uma dívida acaba, a parcela dela não volta
 *   para o bolso: rola para a próxima da fila (é isso que gera a economia).
 * - "Só as parcelas" paga cada parcela no prazo e devolve ao bolso o que sobra.
 *   O `extra` não entra nela: é a linha de base do contrato.
 */

export interface DebtInput {
  id: string;
  name: string;
  /** Valor da parcela mensal, positivo. */
  installment: Decimal;
  /** Parcelas que faltam pagar (inteiro >= 1). */
  remaining: number;
  /** Juro ao mês como fração (0.09 = 9% a.m.). */
  monthlyRate: Decimal;
}

export type Strategy = "parcelas" | "bola-de-neve" | "avalanche";

export interface MonthRow {
  /** 1 = próximo mês. */
  month: number;
  /** Pagamento de cada dívida no mês (mesma ordem de `debts`). */
  payments: Decimal[];
  total: Decimal;
  /** Ids das dívidas quitadas neste mês. */
  paidOff: string[];
}

export interface PayoffPlan {
  strategy: Strategy;
  /** Ordem de ataque (ids). Vazia em "parcelas". */
  order: string[];
  months: number;
  totalPaid: Decimal;
  /** totalPaid menos o saldo de hoje. */
  interest: Decimal;
  /** Mês em que cada dívida acaba, por id. */
  payoffMonth: Record<string, number>;
  schedule: MonthRow[];
}

const ZERO = new Decimal(0);
const ONE = new Decimal(1);
const CENT = new Decimal("0.005");
/** Trava de segurança: 50 anos. Parcelas fixas acabam bem antes disso. */
const MAX_MONTHS = 600;

/** Saldo de hoje: valor presente das parcelas restantes. */
export function presentValue(d: Pick<DebtInput, "installment" | "remaining" | "monthlyRate">): Decimal {
  if (d.monthlyRate.isZero()) return d.installment.times(d.remaining);
  const factor = ONE.minus(ONE.plus(d.monthlyRate).pow(-d.remaining)).div(d.monthlyRate);
  return d.installment.times(factor).toDecimalPlaces(2);
}

/** Total que sai do bolso pagando só as parcelas do contrato. */
export function contractTotal(debts: DebtInput[]): Decimal {
  return debts.reduce((acc, d) => acc.plus(d.installment.times(d.remaining)), ZERO);
}

/** Bola de neve: menor saldo primeiro (empate: maior juro). Avalanche: maior juro primeiro (empate: menor saldo). */
export function attackOrder(debts: DebtInput[], strategy: Strategy): string[] {
  if (strategy === "parcelas") return [];
  const withBalance = debts.map((d) => ({ d, balance: presentValue(d) }));
  withBalance.sort((a, b) => {
    const bySize = a.balance.comparedTo(b.balance);
    const byRate = b.d.monthlyRate.comparedTo(a.d.monthlyRate);
    return strategy === "bola-de-neve" ? bySize || byRate : byRate || bySize;
  });
  return withBalance.map((x) => x.d.id);
}

export function simulatePayoff(debts: DebtInput[], strategy: Strategy, extra: Decimal = ZERO): PayoffPlan {
  const order = attackOrder(debts, strategy);
  const startBalance = debts.reduce((acc, d) => acc.plus(presentValue(d)), ZERO);
  const balances = debts.map((d) => presentValue(d));
  const paidCount = debts.map(() => 0);
  const budget = debts
    .reduce((acc, d) => acc.plus(d.installment), ZERO)
    .plus(strategy === "parcelas" ? ZERO : extra);
  const indexById = new Map(debts.map((d, i) => [d.id, i]));
  const payoffMonth: Record<string, number> = {};
  const schedule: MonthRow[] = [];
  let totalPaid = ZERO;

  const open = (i: number) => balances[i].gt(CENT);

  for (let month = 1; debts.some((_, i) => open(i)) && month <= MAX_MONTHS; month++) {
    const payments = debts.map(() => ZERO);

    // Juros do mês.
    debts.forEach((d, i) => {
      if (open(i)) balances[i] = balances[i].times(ONE.plus(d.monthlyRate));
    });

    // Parcela de cada dívida aberta.
    debts.forEach((d, i) => {
      if (!open(i)) return;
      // Em "parcelas" a última parcela fecha o contrato exatamente (sem resíduo de arredondamento).
      const last = strategy === "parcelas" && paidCount[i] === d.remaining - 1;
      const due = last ? d.installment : Decimal.min(d.installment, balances[i]);
      balances[i] = last ? ZERO : balances[i].minus(due);
      payments[i] = payments[i].plus(due);
      paidCount[i] += 1;
    });

    // O que sobrou do orçamento vai para a primeira dívida aberta da fila, e assim por diante.
    if (strategy !== "parcelas") {
      let pool = budget.minus(payments.reduce((a, p) => a.plus(p), ZERO));
      for (const id of order) {
        if (!pool.gt(CENT)) break;
        const i = indexById.get(id)!;
        if (!open(i)) continue;
        const pay = Decimal.min(pool, balances[i]);
        balances[i] = balances[i].minus(pay);
        payments[i] = payments[i].plus(pay);
        pool = pool.minus(pay);
      }
    }

    const paidOff: string[] = [];
    debts.forEach((d, i) => {
      if (!open(i) && payoffMonth[d.id] === undefined) {
        balances[i] = ZERO;
        payoffMonth[d.id] = month;
        paidOff.push(d.id);
      }
    });

    const rounded = payments.map((p) => p.toDecimalPlaces(2));
    const total = rounded.reduce((a, p) => a.plus(p), ZERO);
    totalPaid = totalPaid.plus(total);
    schedule.push({ month, payments: rounded, total, paidOff });
  }

  return {
    strategy,
    order,
    months: schedule.length,
    totalPaid,
    interest: totalPaid.minus(startBalance),
    payoffMonth,
    schedule,
  };
}

export interface PayoffComparison {
  balanceToday: Decimal;
  contract: PayoffPlan;
  snowball: PayoffPlan;
  avalanche: PayoffPlan;
  /** Método mais barato entre bola de neve e avalanche ("empate" se a diferença for menor que R$ 1). */
  cheaper: "bola-de-neve" | "avalanche" | "empate";
  /** Quanto o mais barato economiza sobre o outro. */
  difference: Decimal;
  /** Mês em que cada método fecha a primeira dívida. */
  firstWin: { snowball: number; avalanche: number };
  /** Mês em que cada método fecha a segunda dívida (null com uma dívida só). */
  secondWin: { snowball: number | null; avalanche: number | null };
}

function nthWin(plan: PayoffPlan, n: number): number | null {
  const months = Object.values(plan.payoffMonth).sort((a, b) => a - b);
  return months[n - 1] ?? null;
}

export function comparePayoff(debts: DebtInput[], extra: Decimal = ZERO): PayoffComparison {
  const contract = simulatePayoff(debts, "parcelas");
  const snowball = simulatePayoff(debts, "bola-de-neve", extra);
  const avalanche = simulatePayoff(debts, "avalanche", extra);
  const diff = snowball.totalPaid.minus(avalanche.totalPaid);
  return {
    balanceToday: debts.reduce((acc, d) => acc.plus(presentValue(d)), ZERO),
    contract,
    snowball,
    avalanche,
    cheaper: diff.abs().lt(1) ? "empate" : diff.gt(0) ? "avalanche" : "bola-de-neve",
    difference: diff.abs(),
    firstWin: { snowball: nthWin(snowball, 1) ?? 0, avalanche: nthWin(avalanche, 1) ?? 0 },
    secondWin: { snowball: nthWin(snowball, 2), avalanche: nthWin(avalanche, 2) },
  };
}
