import Decimal from "decimal.js";

/**
 * Regra 50/30/20 (Necessidades / Desejos / Poupança) sobre as receitas de
 * um período, com método recomendado e cortes sugeridos.
 *
 * Convenções:
 * - Necessidades e Desejos = despesas das categorias com essa natureza.
 * - Poupança = despesas de categorias "Poupança" (aportes, previdência…)
 *   + a sobra do período (receitas − todas as despesas). Mês no vermelho
 *   reduz a poupança — pode ficar negativa.
 * - Despesas sem categoria ou em categoria sem natureza NÃO são chutadas
 *   para nenhum balde: aparecem em `unclassified` para o usuário revisar.
 *   Ainda assim reduzem a sobra, então os três baldes + `unclassified`
 *   somam exatamente a receita.
 */

export type Nature = "NEED" | "WANT" | "SAVINGS";

export interface CategorySpend {
  categoryId: string | null;
  name: string;
  nature: Nature | null;
  /** Gasto no período, positivo. */
  spent: Decimal;
}

export interface Split {
  need: number;
  want: number;
  savings: number;
}

export interface Bucket {
  target: Decimal;
  actual: Decimal;
  /** Fração da receita (0.5 = 50%); null sem receita. */
  actualShare: number | null;
}

export interface CutSuggestion {
  categoryId: string | null;
  name: string;
  spent: Decimal;
  cut: Decimal;
}

export interface BudgetRuleResult {
  income: Decimal;
  split: Split;
  /** Por que este método foi recomendado. */
  splitReason: string;
  needs: Bucket;
  wants: Bucket;
  savings: Bucket;
  unclassified: { total: Decimal; categories: CategorySpend[] };
  cuts: {
    /** Quanto falta para a meta de poupança (0 se já atingiu). */
    gap: Decimal;
    suggestions: CutSuggestion[];
    /** Parte do gap que nem cortando todos os Desejos se cobre. */
    uncovered: Decimal;
  };
}

export const CLASSIC_SPLIT: Split = { need: 0.5, want: 0.3, savings: 0.2 };

/**
 * Escolhe o método a partir do peso real das Necessidades: quando o custo
 * fixo não cabe em 50%, uma meta inalcançável só desanima — adapta-se a
 * divisão mantendo ao menos 10% de poupança.
 */
export function recommendSplit(needShare: number | null): { split: Split; reason: string } {
  if (needShare === null || needShare <= 0.5) {
    return { split: CLASSIC_SPLIT, reason: "Suas necessidades cabem em 50% da receita: use a regra clássica." };
  }
  if (needShare <= 0.6) {
    return {
      split: { need: 0.6, want: 0.2, savings: 0.2 },
      reason: "Necessidades entre 50% e 60%: a divisão 60/20/20 preserva a poupança cortando em Desejos.",
    };
  }
  return {
    split: { need: 0.7, want: 0.2, savings: 0.1 },
    reason:
      needShare > 0.7
        ? "Necessidades acima de 70%: comece por 70/20/10 e priorize renegociar custos fixos (aluguel, contas, dívidas)."
        : "Necessidades entre 60% e 70%: a divisão 70/20/10 é um ponto de partida realista.",
  };
}

function share(value: Decimal, income: Decimal): number | null {
  return income.gt(0) ? value.dividedBy(income).toNumber() : null;
}

function sumSpent(items: CategorySpend[]): Decimal {
  return items.reduce((sum, item) => sum.plus(item.spent), new Decimal(0));
}

/**
 * Distribui `gap` entre as categorias de Desejo proporcionalmente ao gasto
 * de cada uma (quem gasta mais corta mais), nunca cortando mais do que a
 * categoria gastou. Arredonda em centavos; a última categoria absorve a
 * diferença de arredondamento para a soma bater exatamente.
 */
export function suggestCuts(
  gap: Decimal,
  wants: CategorySpend[],
): { suggestions: CutSuggestion[]; uncovered: Decimal } {
  const candidates = wants.filter((w) => w.spent.gt(0)).sort((a, b) => b.spent.comparedTo(a.spent));
  const wantTotal = sumSpent(candidates);
  if (!gap.gt(0) || wantTotal.isZero()) return { suggestions: [], uncovered: Decimal.max(gap, 0) };

  const coverable = Decimal.min(gap, wantTotal);
  const suggestions: CutSuggestion[] = [];
  let allocated = new Decimal(0);

  candidates.forEach((category, index) => {
    const isLast = index === candidates.length - 1;
    const raw = isLast
      ? coverable.minus(allocated)
      : coverable.times(category.spent).dividedBy(wantTotal).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const cut = Decimal.min(raw, category.spent);
    allocated = allocated.plus(cut);
    if (cut.gt(0)) {
      suggestions.push({ categoryId: category.categoryId, name: category.name, spent: category.spent, cut });
    }
  });

  return { suggestions, uncovered: gap.minus(allocated) };
}

export function computeBudgetRule(income: Decimal, expenses: CategorySpend[]): BudgetRuleResult {
  const byNature = (nature: Nature) => expenses.filter((e) => e.nature === nature);
  const needSpent = sumSpent(byNature("NEED"));
  const wantSpent = sumSpent(byNature("WANT"));
  const savingsSpent = sumSpent(byNature("SAVINGS"));
  const unclassifiedItems = expenses.filter((e) => e.nature === null && e.spent.gt(0));
  const totalSpent = sumSpent(expenses);

  const leftover = income.minus(totalSpent);
  const savingsActual = savingsSpent.plus(leftover);

  const { split, reason } = recommendSplit(share(needSpent, income));
  const target = (fraction: number) => income.times(fraction).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  const savingsTarget = target(split.savings);
  const gap = Decimal.max(savingsTarget.minus(savingsActual), 0);
  const { suggestions, uncovered } = suggestCuts(gap, byNature("WANT"));

  return {
    income,
    split,
    splitReason: reason,
    needs: { target: target(split.need), actual: needSpent, actualShare: share(needSpent, income) },
    wants: { target: target(split.want), actual: wantSpent, actualShare: share(wantSpent, income) },
    savings: { target: savingsTarget, actual: savingsActual, actualShare: share(savingsActual, income) },
    unclassified: {
      total: sumSpent(unclassifiedItems),
      categories: [...unclassifiedItems].sort((a, b) => b.spent.comparedTo(a.spent)),
    },
    cuts: { gap, suggestions, uncovered },
  };
}
