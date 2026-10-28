"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { decimalToDb, moneySchema } from "@/lib/money";
import { revalidateDashboard } from "@/lib/revalidate";
import { runAction, UserFacingError, type ActionResult } from "@/lib/action-result";

const goalSchema = z.object({
  name: z.string().trim().min(1, "Dê um nome à meta.").max(80, "Nome muito longo."),
  targetAmount: moneySchema.refine((v) => v.gt(0), "A meta precisa ser maior que zero."),
  /** `YYYY-MM-DD` vindo de <input type="date">, ou vazio. */
  targetDate: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? new Date(`${v}T00:00:00Z`) : null))
    .refine((v) => v === null || !Number.isNaN(v.getTime()), "Data inválida."),
  accountId: z.string().uuid().nullable().optional(),
});

async function assertAccountFree(accountId: string | null | undefined, goalId?: string) {
  if (!accountId) return;
  const taken = await prisma.savingsGoal.findUnique({ where: { accountId }, select: { id: true } });
  if (taken && taken.id !== goalId) {
    throw new UserFacingError("Esta conta já financia outra meta — o saldo contaria duas vezes.");
  }
}

export async function createGoal(input: z.input<typeof goalSchema>): Promise<ActionResult> {
  return runAction(async () => {
    const parsed = goalSchema.parse(input);
    await assertAccountFree(parsed.accountId);
    await prisma.savingsGoal.create({
      data: {
        name: parsed.name,
        targetAmount: decimalToDb(parsed.targetAmount),
        targetDate: parsed.targetDate,
        accountId: parsed.accountId ?? null,
      },
    });
    revalidateDashboard();
    return undefined;
  });
}

const updateGoalSchema = goalSchema.extend({ id: z.string().uuid() });

export async function updateGoal(input: z.input<typeof updateGoalSchema>): Promise<ActionResult> {
  return runAction(async () => {
    const parsed = updateGoalSchema.parse(input);
    await assertAccountFree(parsed.accountId, parsed.id);
    await prisma.savingsGoal.update({
      where: { id: parsed.id },
      data: {
        name: parsed.name,
        targetAmount: decimalToDb(parsed.targetAmount),
        targetDate: parsed.targetDate,
        accountId: parsed.accountId ?? null,
      },
    });
    revalidateDashboard();
    return undefined;
  });
}

const contributionSchema = z.object({
  id: z.string().uuid(),
  /** Positivo = aporte, negativo = retirada. */
  amount: moneySchema.refine((v) => !v.isZero(), "Informe um valor."),
});

/**
 * Registra um aporte (ou retirada) numa meta SEM conta vinculada. Em meta
 * com conta, o progresso é o saldo da conta — aporte manual seria contado
 * duas vezes, então é recusado.
 */
export async function addGoalContribution(input: z.input<typeof contributionSchema>): Promise<ActionResult> {
  return runAction(async () => {
    const parsed = contributionSchema.parse(input);

    await prisma.$transaction(async (tx) => {
      const goal = await tx.savingsGoal.findUniqueOrThrow({ where: { id: parsed.id } });
      if (goal.accountId) {
        throw new UserFacingError("Esta meta acompanha o saldo da conta vinculada — movimente a conta.");
      }
      const next = parsed.amount.plus(goal.savedAmount.toString());
      if (next.isNegative()) {
        throw new UserFacingError("A retirada é maior do que o valor guardado na meta.");
      }
      await tx.savingsGoal.update({ where: { id: goal.id }, data: { savedAmount: decimalToDb(next) } });
    });

    revalidateDashboard();
    return undefined;
  });
}

const deleteGoalSchema = z.object({ id: z.string().uuid() });

export async function deleteGoal(input: z.input<typeof deleteGoalSchema>): Promise<ActionResult> {
  return runAction(async () => {
    const { id } = deleteGoalSchema.parse(input);
    await prisma.savingsGoal.delete({ where: { id } });
    revalidateDashboard();
    return undefined;
  });
}
