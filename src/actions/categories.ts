"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { moneySchema } from "@/lib/money";
import { revalidateDashboard } from "@/lib/revalidate";
import { assertAuthorized } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";

const categoryTypeSchema = z.enum(["INCOME", "EXPENSE"]);

const createCategorySchema = z.object({
  name: z.string().trim().min(1, "Nome obrigatório."),
  type: categoryTypeSchema,
  icon: z.string().trim().optional(),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Cor em formato #RRGGBB.").optional(),
  budgetLimit: moneySchema.nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
});

const updateCategorySchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).optional(),
  icon: z.string().trim().nullable().optional(),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  budgetLimit: moneySchema.nullable().optional(),
});

export type CreateCategoryInput = z.input<typeof createCategorySchema>;
export type UpdateCategoryInput = z.input<typeof updateCategorySchema>;

/** Cria uma categoria (opcionalmente com teto orçamentário mensal). */
export async function createCategory(input: CreateCategoryInput) {
  await assertAuthorized();
  const parsed = createCategorySchema.parse(input);

  if (parsed.parentId) {
    const parent = await prisma.category.findUniqueOrThrow({ where: { id: parsed.parentId } });
    if (parent.type !== parsed.type) {
      throw new DomainError("A subcategoria deve ter o mesmo tipo (receita/despesa) da categoria-mãe.");
    }
  }

  const category = await prisma.$transaction(async (tx) => {
    const created = await tx.category.create({
      data: {
        name: parsed.name,
        type: parsed.type,
        icon: parsed.icon ?? null,
        color: parsed.color ?? null,
        budgetLimit: parsed.budgetLimit?.toFixed(2) ?? null,
        parentId: parsed.parentId ?? null,
      },
    });
    await recordAudit(tx, {
      action: "category.create",
      entityType: "Category",
      entityId: created.id,
      payload: { name: created.name, type: created.type },
    });
    return created;
  });

  revalidateDashboard();
  return category;
}

/** Atualiza nome/ícone/cor e — principalmente — o teto orçamentário mensal. */
export async function updateCategory(input: UpdateCategoryInput) {
  await assertAuthorized();
  const parsed = updateCategorySchema.parse(input);

  const category = await prisma.$transaction(async (tx) => {
    const updated = await tx.category.update({
      where: { id: parsed.id },
      data: {
        name: parsed.name ?? undefined,
        icon: parsed.icon === null ? null : (parsed.icon ?? undefined),
        color: parsed.color === null ? null : (parsed.color ?? undefined),
        budgetLimit:
          parsed.budgetLimit === null
            ? null
            : parsed.budgetLimit !== undefined
              ? parsed.budgetLimit.toFixed(2)
              : undefined,
      },
    });
    await recordAudit(tx, {
      action: "category.update",
      entityType: "Category",
      entityId: updated.id,
      payload: { name: updated.name, budgetLimit: updated.budgetLimit?.toString() ?? null },
    });
    return updated;
  });

  revalidateDashboard();
  return category;
}

/**
 * Funde `sourceId` em `targetId`: reaponta todas as transações e regras de
 * categorização da categoria de origem para a de destino e remove a origem.
 * Tudo em uma única transação de banco — nunca fica estado intermediário.
 */
export async function mergeCategory(input: { sourceId: string; targetId: string }) {
  await assertAuthorized();
  const { sourceId, targetId } = z
    .object({ sourceId: z.string().uuid(), targetId: z.string().uuid() })
    .parse(input);

  if (sourceId === targetId) {
    throw new DomainError("A categoria de origem e destino devem ser diferentes.");
  }

  await prisma.$transaction(async (tx) => {
    const [source, target] = await Promise.all([
      tx.category.findUniqueOrThrow({ where: { id: sourceId } }),
      tx.category.findUniqueOrThrow({ where: { id: targetId } }),
    ]);
    if (source.type !== target.type) {
      throw new DomainError("Não é possível fundir categorias de tipos diferentes (receita/despesa).");
    }

    const movedTransactions = await tx.transaction.updateMany({
      where: { categoryId: sourceId },
      data: { categoryId: targetId },
    });
    await tx.categoryRule.deleteMany({ where: { categoryId: sourceId } });
    // Subcategorias da origem sobem um nível (viram filhas do destino).
    await tx.category.updateMany({
      where: { parentId: sourceId },
      data: { parentId: targetId },
    });
    await tx.category.delete({ where: { id: sourceId } });

    await recordAudit(tx, {
      action: "category.merge",
      entityType: "Category",
      entityId: targetId,
      payload: { sourceId, targetId, movedTransactions: movedTransactions.count },
    });
  });

  revalidateDashboard();
}

// ----------------------------------------------------------------------------
// Regras de categorização automática
// ----------------------------------------------------------------------------

const upsertCategoryRuleSchema = z.object({
  pattern: z.string().trim().min(2, "Padrão muito curto (mínimo 2 caracteres)."),
  categoryId: z.string().uuid(),
  priority: z.number().int().min(0).max(1000).default(0),
});

/** Cria ou atualiza uma regra de categorização (padrão → categoria). */
export async function upsertCategoryRule(input: z.input<typeof upsertCategoryRuleSchema>) {
  await assertAuthorized();
  const parsed = upsertCategoryRuleSchema.parse(input);

  const rule = await prisma.categoryRule.upsert({
    where: { pattern_categoryId: { pattern: parsed.pattern, categoryId: parsed.categoryId } },
    create: parsed,
    update: { priority: parsed.priority },
  });

  revalidateDashboard();
  return rule;
}

/** Remove uma regra de categorização. */
export async function deleteCategoryRule(input: { id: string }) {
  await assertAuthorized();
  const { id } = z.object({ id: z.string().uuid() }).parse(input);
  await prisma.categoryRule.delete({ where: { id } });
  revalidateDashboard();
}

/**
 * Aplica todas as regras às transações sem categoria (ou às fornecidas em
 * `ids`): primeira regra cujo `pattern` aparece na descrição normalizada
 * vence (maior `priority` primeiro). Não toca saldo — categoria é metadado.
 */
export async function applyCategoryRules(input: { ids?: string[] } = {}) {
  await assertAuthorized();
  const { ids } = z.object({ ids: z.array(z.string().uuid()).optional() }).parse(input);

  const [rules, candidates] = await Promise.all([
    prisma.categoryRule.findMany({ orderBy: [{ priority: "desc" }, { createdAt: "asc" }] }),
    prisma.transaction.findMany({
      where: {
        ...(ids ? { id: { in: ids } } : { categoryId: null }),
        type: { in: ["INCOME", "EXPENSE"] },
      },
      select: { id: true, description: true, categoryId: true },
    }),
  ]);

  if (rules.length === 0 || candidates.length === 0) return { matched: 0 };

  const { applyRules } = await import("@/lib/financial-engine/category-rules");
  const assignments = applyRules(candidates, rules);

  await prisma.$transaction(async (tx) => {
    for (const [transactionId, categoryId] of assignments) {
      await tx.transaction.update({ where: { id: transactionId }, data: { categoryId } });
    }
  });

  if (assignments.size > 0) revalidateDashboard();
  return { matched: assignments.size };
}
