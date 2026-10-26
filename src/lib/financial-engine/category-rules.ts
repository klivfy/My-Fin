import { normalizeDescription } from "./reconciliation";

export interface CategoryRuleLike {
  pattern: string;
  categoryId: string;
}

export interface CategorizableTransaction {
  id: string;
  description: string;
}

/**
 * Motor de categorização automática: para cada transação, a primeira regra
 * cujo `pattern` (normalizado) aparece como substring da descrição
 * normalizada vence. A ORDEM das regras é a ordem de precedência — o
 * chamador deve ordená-las por prioridade antes de chamar.
 *
 * Função pura (sem I/O) para ser trivialmente testável.
 */
export function applyRules(
  transactions: CategorizableTransaction[],
  rules: CategoryRuleLike[],
): Map<string, string> {
  const normalizedRules = rules.map((rule) => ({
    categoryId: rule.categoryId,
    pattern: normalizeDescription(rule.pattern),
  }));

  const assignments = new Map<string, string>();
  for (const transaction of transactions) {
    const description = normalizeDescription(transaction.description);
    for (const rule of normalizedRules) {
      if (rule.pattern.length > 0 && description.includes(rule.pattern)) {
        assignments.set(transaction.id, rule.categoryId);
        break;
      }
    }
  }
  return assignments;
}

/** Atalho para categorizar descrições na ingestão (sem ids ainda). */
export function matchCategory(description: string, rules: CategoryRuleLike[]): string | null {
  const normalized = normalizeDescription(description);
  for (const rule of rules) {
    const pattern = normalizeDescription(rule.pattern);
    if (pattern.length > 0 && normalized.includes(pattern)) return rule.categoryId;
  }
  return null;
}
