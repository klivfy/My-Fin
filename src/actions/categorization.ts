"use server";

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { toDecimal } from "@/lib/money";
import { normalizeRulePattern } from "@/lib/financial-engine/categorization";
import {
  AI_BATCH_SIZE,
  AiCategorizationError,
  categorizeBatch,
  type AiCandidate,
} from "@/lib/financial-engine/ai-categorizer";
import { revalidateDashboard } from "@/lib/revalidate";

/** Transações elegíveis à fila de revisão: receitas/despesas sem categoria. */
const UNCATEGORIZED_WHERE = {
  categoryId: null,
  type: { in: ["INCOME", "EXPENSE"] as Array<"INCOME" | "EXPENSE"> },
};

const categorizeSchema = z.object({
  transactionId: z.string().uuid(),
  categoryId: z.string().uuid(),
  /** Quando informado, cria (ou atualiza) a regra e aplica nas pendentes. */
  rulePattern: z.string().trim().optional(),
});

export interface CategorizeResult {
  /** Outras transações pendentes categorizadas pela regra recém-criada. */
  appliedToOthers: number;
}

/**
 * Categoriza manualmente uma transação. Opcionalmente cria uma regra a
 * partir de um trecho da descrição e a aplica de imediato às demais
 * transações ainda sem categoria.
 */
export async function categorizeTransaction(
  input: z.input<typeof categorizeSchema>,
): Promise<CategorizeResult> {
  const parsed = categorizeSchema.parse(input);
  const pattern = parsed.rulePattern ? normalizeRulePattern(parsed.rulePattern) : null;
  if (parsed.rulePattern && !pattern) {
    throw new Error("O trecho da regra precisa ter ao menos 4 caracteres.");
  }

  const appliedToOthers = await prisma.$transaction(async (tx) => {
    await tx.transaction.update({
      where: { id: parsed.transactionId },
      data: { categoryId: parsed.categoryId, categorizationSource: "MANUAL" },
    });

    if (!pattern) return 0;

    await tx.categorizationRule.upsert({
      where: { pattern },
      create: { pattern, categoryId: parsed.categoryId },
      update: { categoryId: parsed.categoryId },
    });

    const { count } = await tx.transaction.updateMany({
      where: { ...UNCATEGORIZED_WHERE, description: { contains: pattern } },
      data: { categoryId: parsed.categoryId, categorizationSource: "RULE" },
    });
    return count;
  });

  revalidateDashboard();
  return { appliedToOthers };
}

const deleteRuleSchema = z.object({ id: z.string().uuid() });

/** Remove uma regra. Transações já categorizadas por ela não mudam. */
export async function deleteCategorizationRule(input: z.input<typeof deleteRuleSchema>) {
  const { id } = deleteRuleSchema.parse(input);
  await prisma.categorizationRule.delete({ where: { id } });
  revalidateDashboard();
}

const setNatureSchema = z.object({
  categoryId: z.string().uuid(),
  nature: z.enum(["NEED", "WANT", "SAVINGS"]).nullable(),
});

/** Define se uma categoria de despesa é Necessidade, Desejo ou Poupança. */
export async function setCategoryNature(input: z.input<typeof setNatureSchema>) {
  const parsed = setNatureSchema.parse(input);
  await prisma.category.update({
    where: { id: parsed.categoryId, type: "EXPENSE" },
    data: { nature: parsed.nature },
  });
  revalidateDashboard();
}

const aiBatchSchema = z.object({
  /**
   * Quantas pendentes pular (as que a IA já viu nesta rodada e deixou para
   * revisão manual) — sem isso, um lote 100% "confiança baixa" seria
   * reenviado para sempre.
   */
  skip: z.number().int().min(0).default(0),
});

export type AiCategorizationResult =
  | { status: "missing_credentials" }
  | { status: "failed"; message: string }
  | { status: "done"; processed: number; categorized: number; pending: number };

/**
 * Envia UM lote de pendentes ao Claude e aplica as sugestões de confiança
 * alta/média. Um lote por chamada mantém cada Server Action bem abaixo do
 * timeout de funções serverless; a tela chama de novo até `processed === 0`.
 *
 * Só grava em transações que continuam sem categoria: se o usuário
 * categorizou algo enquanto a IA rodava, a escolha manual prevalece.
 */
export async function runAiCategorizationBatch(
  input: z.input<typeof aiBatchSchema> = {},
): Promise<AiCategorizationResult> {
  const { skip } = aiBatchSchema.parse(input);

  // Em deploy a credencial vem do ambiente; sem ela o SDK só falharia na
  // requisição, com um erro genérico.
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    return { status: "missing_credentials" };
  }
  const client = new Anthropic();

  const [pending, categories] = await Promise.all([
    prisma.transaction.findMany({
      where: UNCATEGORIZED_WHERE,
      orderBy: [{ date: "desc" }, { id: "asc" }],
      skip,
      take: AI_BATCH_SIZE,
      select: { id: true, date: true, amount: true, description: true },
    }),
    prisma.category.findMany({
      orderBy: [{ type: "asc" }, { name: "asc" }],
      select: { id: true, name: true, type: true },
    }),
  ]);

  const candidates: AiCandidate[] = pending.map((t) => ({
    id: t.id,
    date: t.date,
    amount: toDecimal(t.amount.toString()),
    description: t.description,
  }));

  let categorized = 0;
  if (candidates.length > 0 && categories.length > 0) {
    let suggestions;
    try {
      suggestions = await categorizeBatch(client, candidates, categories);
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError) return { status: "missing_credentials" };
      if (error instanceof AiCategorizationError || error instanceof Anthropic.APIError) {
        return { status: "failed", message: error.message };
      }
      throw error;
    }

    if (suggestions.length > 0) {
      const results = await prisma.$transaction(
        suggestions.map((s) =>
          prisma.transaction.updateMany({
            where: { id: s.transactionId, categoryId: null },
            data: { categoryId: s.categoryId, categorizationSource: "AI" },
          }),
        ),
      );
      categorized = results.reduce((sum, r) => sum + r.count, 0);
      revalidateDashboard();
    }
  }

  const remaining = await prisma.transaction.count({ where: UNCATEGORIZED_WHERE });
  return { status: "done", processed: candidates.length, categorized, pending: remaining };
}
