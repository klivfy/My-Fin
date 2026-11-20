import Decimal from "decimal.js";

/**
 * Os 6 potes do salário (T. Harv Eker, "Os Segredos da Mente Milionária"):
 * toda entrada é dividida em percentuais fixos. Aqui o método vira uma LENTE
 * sobre as despesas já categorizadas, não uma segunda contabilidade:
 *
 * - Cada categoria de despesa pertence a um pote (campo `pot`). Sem pote,
 *   vale a natureza do 50/30/20: Necessidade vira Necessidades, Desejo vira
 *   Diversão, Poupança vira Liberdade financeira.
 * - Potes de gasto (Necessidades, Instrução, Doações, Diversão): "usado" é o
 *   que saiu das categorias do pote, e a meta é um teto.
 * - Potes de guardar (Liberdade financeira, Longo prazo): "usado" é o que foi
 *   aportado (categorias de aporte), e a meta é um piso. Aporte feito por
 *   transferência entre contas não entra: só lançamento categorizado.
 * - Os percentuais são do método, mas editáveis: quem ganha pouco pode não
 *   ter 50% suficiente para necessidades (ver `recommendSplit` em budget-rule).
 */

export type Pot = "NECESSIDADES" | "LIBERDADE" | "LONGO_PRAZO" | "INSTRUCAO" | "DOACOES" | "DIVERSAO";
export type PotKind = "spend" | "save";
export type Nature = "NEED" | "WANT" | "SAVINGS";

export const POT_ORDER: Pot[] = ["NECESSIDADES", "LIBERDADE", "LONGO_PRAZO", "INSTRUCAO", "DOACOES", "DIVERSAO"];

export const POTS: Record<Pot, { label: string; kind: PotKind; defaultPercent: number; hint: string }> = {
  NECESSIDADES: { label: "Necessidades", kind: "spend", defaultPercent: 50, hint: "aluguel, mercado, contas" },
  LIBERDADE: { label: "Liberdade financeira", kind: "save", defaultPercent: 10, hint: "só para investir, nunca gastar" },
  LONGO_PRAZO: { label: "Longo prazo", kind: "save", defaultPercent: 10, hint: "carro, viagem, sem parcelar" },
  INSTRUCAO: { label: "Instrução financeira", kind: "spend", defaultPercent: 10, hint: "livros e cursos" },
  DOACOES: { label: "Doações", kind: "spend", defaultPercent: 10, hint: "ajudar quem precisa" },
  DIVERSAO: { label: "Diversão", kind: "spend", defaultPercent: 10, hint: "lazer, sem culpa" },
};

export type Percents = Record<Pot, Decimal>;

export function defaultPercents(): Percents {
  return Object.fromEntries(POT_ORDER.map((p) => [p, new Decimal(POTS[p].defaultPercent)])) as Percents;
}

/** Pote efetivo de uma categoria de despesa; null = sem pote e sem natureza. */
export function resolvePot(nature: Nature | null, pot: Pot | null): Pot | null {
  if (pot) return pot;
  if (nature === "NEED") return "NECESSIDADES";
  if (nature === "WANT") return "DIVERSAO";
  if (nature === "SAVINGS") return "LIBERDADE";
  return null;
}

/** Percentuais válidos: cada um entre 0 e 100 e soma exatamente 100. Devolve a mensagem de erro ou null. */
export function validatePercents(percents: Percents): string | null {
  for (const pot of POT_ORDER) {
    const v = percents[pot];
    if (!v.isFinite() || v.lt(0) || v.gt(100)) return `${POTS[pot].label}: use um valor entre 0 e 100.`;
  }
  const sum = POT_ORDER.reduce((acc, p) => acc.plus(percents[p]), new Decimal(0));
  if (!sum.eq(100)) return `Os potes somam ${sum.toDecimalPlaces(2).toString().replace(".", ",")}%. A soma precisa ser 100%.`;
  return null;
}

/**
 * Divide um valor entre os potes em centavos, sem perder nem criar dinheiro:
 * método do maior resto (cada pote leva o piso em centavos e os centavos que
 * sobram vão para quem tem a maior fração, empate pela ordem dos potes).
 */
export function splitAmount(amount: Decimal, percents: Percents): Record<Pot, Decimal> {
  const cents = amount.times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const raw = POT_ORDER.map((pot) => cents.times(percents[pot]).div(100));
  const floors = raw.map((r) => r.floor());
  let left = cents.minus(floors.reduce((a, f) => a.plus(f), new Decimal(0))).toNumber();
  const byRemainder = raw
    .map((r, i) => ({ i, rem: r.minus(floors[i]) }))
    .sort((a, b) => b.rem.comparedTo(a.rem) || a.i - b.i);
  for (const { i } of byRemainder) {
    if (left <= 0) break;
    floors[i] = floors[i].plus(1);
    left -= 1;
  }
  return Object.fromEntries(POT_ORDER.map((pot, i) => [pot, floors[i].div(100)])) as Record<Pot, Decimal>;
}

export interface PotLine {
  pot: Pot;
  percent: Decimal;
  /** Meta: percentual da receita do período. */
  target: Decimal;
  /** Gasto (potes de gasto) ou aportado (potes de guardar) no período. */
  used: Decimal;
  /** Fração da meta usada; null com meta zero. */
  usedShare: number | null;
  /** Gasto: o que ainda cabe (0 se passou). Guardar: o que falta aportar (0 se já bateu). */
  remaining: Decimal;
  /** Gasto: passou da meta. Guardar: ainda abaixo da meta com a receita já lançada. */
  attention: boolean;
}

export interface PotsResult {
  income: Decimal;
  lines: PotLine[];
  /** Despesas sem pote e sem natureza: não são chutadas para nenhum pote. */
  unassigned: Decimal;
}

export interface PotSpend {
  pot: Pot | null;
  /** Positivo. */
  spent: Decimal;
}

export function computePots(income: Decimal, spends: PotSpend[], percents: Percents): PotsResult {
  const used = new Map<Pot, Decimal>();
  let unassigned = new Decimal(0);
  for (const s of spends) {
    if (s.pot === null) unassigned = unassigned.plus(s.spent);
    else used.set(s.pot, (used.get(s.pot) ?? new Decimal(0)).plus(s.spent));
  }
  const targets = splitAmount(income.gt(0) ? income : new Decimal(0), percents);

  const lines: PotLine[] = POT_ORDER.map((pot) => {
    const target = targets[pot];
    const u = used.get(pot) ?? new Decimal(0);
    const kind = POTS[pot].kind;
    const remaining = Decimal.max(target.minus(u), 0);
    return {
      pot,
      percent: percents[pot],
      target,
      used: u,
      usedShare: target.gt(0) ? u.div(target).toNumber() : null,
      remaining,
      attention: kind === "spend" ? u.gt(target) : income.gt(0) && u.lt(target),
    };
  });
  return { income, lines, unassigned };
}
