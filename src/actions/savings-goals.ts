"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { moneySchema } from "@/lib/money";
import { revalidateDashboard } from "@/lib/revalidate";
import { assertAuthorized } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";

const savingsGoalSchema = z.object({
  name: z.string().trim().min(1, "Nome obrigatório."),
  targetAmount: moneySchema.refine((v) => v.isPositive(), "O valor-alvo deve ser positivo."),
  targetDate: z.coerce.date(),
  accountId: z.string().uuid(),
});

const updateSavingsGoalSchema = savingsGoalSchema.partial().extend({ id: z.string().uuid() });

export type CreateSavingsGoalInput = z.input<typeof savingsGoalSchema>;
export type UpdateSavingsGoalInput = z.input<typeof updateSavingsGoalSchema>;

/** Cria uma meta de poupança vinculada a uma conta. */
export async function createSavingsGoal(input: CreateSavingsGoalInput) {
  await assertAuthorized();
  const parsed = savingsGoalSchema.parse(input);

  const goal = await prisma.$transaction(async (tx) => {
    const created = await tx.savingsGoal.create({
      data: {
        name: parsed.name,
        targetAmount: parsed.targetAmount.toFixed(2),
        targetDate: parsed.targetDate,
        accountId: parsed.accountId,
      },
    });
    await recordAudit(tx, {
      action: "savingsGoal.create",
      entityType: "SavingsGoal",
      entityId: created.id,
      payload: { name: created.name, targetAmount: created.targetAmount.toString() },
    });
    return created;
  });

  revalidateDashboard();
  return goal;
}

/** Atualiza uma meta de poupança. */
export async function updateSavingsGoal(input: UpdateSavingsGoalInput) {
  await assertAuthorized();
  const parsed = updateSavingsGoalSchema.parse(input);

  const goal = await prisma.savingsGoal.update({
    where: { id: parsed.id },
    data: {
      name: parsed.name ?? undefined,
      targetAmount: parsed.targetAmount?.toFixed(2),
      targetDate: parsed.targetDate,
      accountId: parsed.accountId,
    },
  });

  revalidateDashboard();
  return goal;
}

/** Exclui uma meta (não afeta transações nem saldo — é apenas um marcador). */
export async function deleteSavingsGoal(input: { id: string }) {
  await assertAuthorized();
  const { id } = z.object({ id: z.string().uuid() }).parse(input);
  await prisma.$transaction(async (tx) => {
    await tx.savingsGoal.delete({ where: { id } });
    await recordAudit(tx, {
      action: "savingsGoal.delete",
      entityType: "SavingsGoal",
      entityId: id,
    });
  });
  revalidateDashboard();
}
