import Decimal from "decimal.js";

/**
 * Alocador da sobra: uma fila única para o dinheiro que sobra por mês, no
 * lugar de cada tela sugerir a mesma sobra por conta própria.
 *
 * Fila, em ordem de prioridade (a ordem é o argumento: custo de não seguir):
 * 1. Reserva mínima: 1 mês de custo essencial. Sem ela, qualquer imprevisto
 *    vira dívida nova.
 * 2. Dívidas com juro acima de `EXPENSIVE_DEBT_RATE_PCT` ao mês, pela
 *    avalanche (juro mais alto primeiro). Nenhum investimento seguro paga isso.
 * 3. Reserva completa (`EMERGENCY_FUND_MONTHS` meses de custo essencial).
 * 4. Dívidas baratas, pela avalanche.
 * 5. Metas, na ordem de criação.
 * 6. Livre: o que sobrar pode ir para investimentos. Só prioridade e classe;
 *    ativo específico é recomendação regulada e não é papel do app.
 *
 * `pool` é o aporte mensal já com folga (80% da sobra média, ver
 * `suggestContribution`): a soma dos passos fecha exatamente nele.
 */

export const EXPENSIVE_DEBT_RATE_PCT = 1;
export const MIN_RESERVE_MONTHS = 1;
export const FULL_RESERVE_MONTHS = 6;

export interface AllocDebt {
  id: string;
  name: string;
  /** Juro ao mês em porcentagem (9.2 = 9,2% a.m.). */
  monthlyRatePct: number;
  /** Quanto falta para quitar (valor presente das parcelas). */
  balance: Decimal;
}

export interface AllocGoal {
  id: string;
  name: string;
  remaining: Decimal;
}

export interface AllocInput {
  pool: Decimal;
  /** Custo mensal essencial (Necessidades, ou gasto total sem naturezas). */
  monthlyEssential: Decimal;
  /** Saldo que já funciona como reserva (contas de poupança). */
  reserveBalance: Decimal;
  debts: AllocDebt[];
  goals: AllocGoal[];
}

export type StepKind = "RESERVA_MINIMA" | "DIVIDA" | "RESERVA_COMPLETA" | "META" | "LIVRE";

export interface AllocStep {
  /** Chave estável (usada para dispensar a sugestão). */
  id: string;
  kind: StepKind;
  label: string;
  amount: Decimal;
  /** Id da dívida ou da meta, quando o passo é de uma delas. */
  refId?: string;
  /** Para dívidas: o juro que justifica a posição na fila. */
  ratePct?: number;
}

export interface Allocation {
  pool: Decimal;
  steps: AllocStep[];
  totals: { reserve: Decimal; debts: Decimal; goals: Decimal; free: Decimal };
}

const ZERO = new Decimal(0);

function avalancheOrder(debts: AllocDebt[]): AllocDebt[] {
  return [...debts].sort((a, b) => b.monthlyRatePct - a.monthlyRatePct || a.balance.comparedTo(b.balance));
}

export function allocateSurplus(input: AllocInput): Allocation {
  const pool = Decimal.max(input.pool, ZERO);
  let left = pool;
  const steps: AllocStep[] = [];

  const take = (want: Decimal): Decimal => {
    const got = Decimal.min(Decimal.max(want, ZERO), left);
    left = left.minus(got);
    return got;
  };
  const push = (step: Omit<AllocStep, "amount">, amount: Decimal) => {
    if (amount.gt(0)) steps.push({ ...step, amount });
  };

  const reserveBalance = Decimal.max(input.reserveBalance, ZERO);
  const minReserve = input.monthlyEssential.times(MIN_RESERVE_MONTHS);
  const fullReserve = input.monthlyEssential.times(FULL_RESERVE_MONTHS);

  const toMin = take(minReserve.minus(reserveBalance));
  push({ id: "alloc:reserva-minima", kind: "RESERVA_MINIMA", label: "Reserva mínima (1 mês de custo essencial)" }, toMin);

  const expensive = avalancheOrder(input.debts.filter((d) => d.monthlyRatePct > EXPENSIVE_DEBT_RATE_PCT));
  for (const d of expensive) {
    push(
      { id: `alloc:divida:${d.id}`, kind: "DIVIDA", label: d.name, refId: d.id, ratePct: d.monthlyRatePct },
      take(d.balance),
    );
  }

  const toFull = take(fullReserve.minus(reserveBalance).minus(toMin));
  push({ id: "alloc:reserva-completa", kind: "RESERVA_COMPLETA", label: `Reserva completa (${FULL_RESERVE_MONTHS} meses)` }, toFull);

  const cheap = avalancheOrder(input.debts.filter((d) => d.monthlyRatePct <= EXPENSIVE_DEBT_RATE_PCT));
  for (const d of cheap) {
    push(
      { id: `alloc:divida:${d.id}`, kind: "DIVIDA", label: d.name, refId: d.id, ratePct: d.monthlyRatePct },
      take(d.balance),
    );
  }

  for (const g of input.goals) {
    push({ id: `alloc:meta:${g.id}`, kind: "META", label: g.name, refId: g.id }, take(g.remaining));
  }

  push({ id: "alloc:livre", kind: "LIVRE", label: "Livre para investir" }, take(left));

  const sum = (kinds: StepKind[]) =>
    steps.filter((s) => kinds.includes(s.kind)).reduce((a, s) => a.plus(s.amount), ZERO);

  return {
    pool,
    steps,
    totals: {
      reserve: sum(["RESERVA_MINIMA", "RESERVA_COMPLETA"]),
      debts: sum(["DIVIDA"]),
      goals: sum(["META"]),
      free: sum(["LIVRE"]),
    },
  };
}
