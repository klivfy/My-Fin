import { normalizeDescription } from "./reconciliation";

export interface CategorizationRuleInput {
  pattern: string;
  categoryId: string;
}

/** Padrões menores que isso casariam com quase tudo ("PIX", "TED"…). */
export const MIN_RULE_PATTERN_LENGTH = 4;

/**
 * Normaliza e valida o trecho de uma nova regra. Retorna `null` quando o
 * trecho é curto demais para ser um discriminador útil.
 */
export function normalizeRulePattern(pattern: string): string | null {
  const normalized = normalizeDescription(pattern);
  return normalized.length >= MIN_RULE_PATTERN_LENGTH ? normalized : null;
}

/**
 * Aplica as regras determinísticas a uma descrição. Casamento por
 * substring sobre a descrição normalizada; quando várias regras casam,
 * vence o padrão mais longo (mais específico), com desempate alfabético
 * para o resultado não depender da ordem em que o banco devolveu as regras.
 */
export function matchCategory(description: string, rules: CategorizationRuleInput[]): string | null {
  const normalized = normalizeDescription(description);
  let best: CategorizationRuleInput | null = null;

  for (const rule of rules) {
    if (!normalized.includes(rule.pattern)) continue;
    if (
      !best ||
      rule.pattern.length > best.pattern.length ||
      (rule.pattern.length === best.pattern.length && rule.pattern < best.pattern)
    ) {
      best = rule;
    }
  }

  return best?.categoryId ?? null;
}
