import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type Decimal from "decimal.js";
import { z } from "zod";

/**
 * Categorização assistida por IA (Claude) das transações que as regras
 * determinísticas não resolveram.
 *
 * Privacidade: só saem daqui data, valor e a descrição MASCARADA (sem
 * sequências longas de dígitos nem e-mails) — nunca nome de conta, saldo
 * ou identificadores internos. Cada transação vai com uma referência
 * numérica local (`ref`), e as categorias com chaves curtas (`c1`, `c2`…).
 *
 * Itens de confiança baixa NÃO são aplicados: continuam na fila de revisão
 * em vez de virarem um palpite silencioso.
 */

export const AI_MODEL = "claude-opus-5-5";
export const AI_BATCH_SIZE = 50;

export interface AiCandidate {
  id: string;
  date: Date;
  /** Assinado: negativo = débito. */
  amount: Decimal;
  description: string;
}

export interface AiCategoryOption {
  id: string;
  name: string;
  type: "INCOME" | "EXPENSE";
}

export interface AiSuggestion {
  transactionId: string;
  categoryId: string;
}

/** Mascara números de conta/cartão/CPF/CNPJ/telefone e e-mails. */
export function maskSensitive(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[EMAIL]")
    .replace(/\d[\d.\-/ ]*\d/g, (match) => {
      const digits = match.replace(/\D/g, "");
      return digits.length >= 5 ? "#".repeat(Math.min(digits.length, 8)) : match;
    });
}

export function buildCategoryKeys(categories: AiCategoryOption[]): Map<string, AiCategoryOption> {
  return new Map(categories.map((category, index) => [`c${index + 1}`, category]));
}

function buildResultSchema(keys: string[]) {
  return z.object({
    results: z.array(
      z.object({
        ref: z.number().int(),
        category: z.enum(keys as [string, ...string[]]).nullable(),
        confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
      }),
    ),
  });
}

export type AiBatchResult = z.infer<ReturnType<typeof buildResultSchema>>;

/**
 * Converte a resposta do modelo em sugestões aplicáveis, descartando:
 * confiança baixa, categoria nula ou desconhecida, `ref` fora do lote e
 * categoria de tipo incompatível com o sinal do valor (débito só recebe
 * categoria de despesa; crédito, de receita).
 */
export function resolveSuggestions(
  result: AiBatchResult,
  batch: AiCandidate[],
  categoryKeys: Map<string, AiCategoryOption>,
): AiSuggestion[] {
  const suggestions: AiSuggestion[] = [];
  const seen = new Set<number>();

  for (const item of result.results) {
    if (item.confidence === "LOW" || item.category === null) continue;
    if (seen.has(item.ref)) continue;
    const candidate = batch[item.ref];
    const category = categoryKeys.get(item.category);
    if (!candidate || !category) continue;

    const expectedType = candidate.amount.isNegative() ? "EXPENSE" : "INCOME";
    if (category.type !== expectedType) continue;

    seen.add(item.ref);
    suggestions.push({ transactionId: candidate.id, categoryId: category.id });
  }

  return suggestions;
}

const SYSTEM_PROMPT = `Você categoriza transações de extratos bancários brasileiros de uma pessoa física.

Para cada transação, escolha a chave de categoria mais adequada da lista fornecida e informe a confiança:
- HIGH: o estabelecimento ou a natureza do lançamento deixa a categoria clara.
- MEDIUM: provável, mas a descrição é genérica.
- LOW: não dá para saber pela descrição (ex.: Pix ou TED para pessoa sem contexto). Nesse caso use category null.

Valores negativos são débitos e só podem receber categorias de despesa; positivos são créditos e só podem receber categorias de receita.
Trechos como "####" ou "[EMAIL]" foram mascarados por privacidade; não tente inferi-los.
Prefira LOW a adivinhar: itens incertos vão para revisão manual.
Responda com exatamente um item em "results" para cada "ref" recebida.`;

function buildUserMessage(batch: AiCandidate[], categoryKeys: Map<string, AiCategoryOption>): string {
  const categoryLines = [...categoryKeys.entries()].map(
    ([key, category]) => `${key}: ${category.name} (${category.type === "EXPENSE" ? "despesa" : "receita"})`,
  );
  const transactionLines = batch.map(
    (t, ref) =>
      `${ref} | ${t.date.toISOString().slice(0, 10)} | ${t.amount.toFixed(2)} | ${maskSensitive(t.description)}`,
  );

  return [
    "<categorias>",
    ...categoryLines,
    "</categorias>",
    "",
    "<transacoes formato=\"ref | data | valor | descrição\">",
    ...transactionLines,
    "</transacoes>",
  ].join("\n");
}

export class AiCategorizationError extends Error {}

/** Envia UM lote (até `AI_BATCH_SIZE` itens) ao Claude e devolve as sugestões aplicáveis. */
export async function categorizeBatch(
  client: Anthropic,
  batch: AiCandidate[],
  categories: AiCategoryOption[],
): Promise<AiSuggestion[]> {
  if (batch.length === 0 || categories.length === 0) return [];

  const categoryKeys = buildCategoryKeys(categories);
  const schema = buildResultSchema([...categoryKeys.keys()]);

  const response = await client.beta.messages.parse({
    model: AI_MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(schema) },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserMessage(batch, categoryKeys) }],
  });

  if (response.stop_reason === "refusal") {
    throw new AiCategorizationError("O modelo recusou categorizar este lote.");
  }
  if (!response.parsed_output) {
    throw new AiCategorizationError(`Resposta da IA sem JSON válido (stop_reason: ${response.stop_reason}).`);
  }

  return resolveSuggestions(response.parsed_output, batch, categoryKeys);
}
