"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { decimalToDb, moneySchema } from "@/lib/money";
import { revalidateDashboard } from "@/lib/revalidate";
import { runAction, UserFacingError, type ActionResult } from "@/lib/action-result";

const debtSchema = z.object({
  name: z.string().trim().min(1, "Dê um nome à dívida.").max(80, "Nome muito longo."),
  installment: moneySchema.refine((v) => v.gt(0), "A parcela precisa ser maior que zero."),
  remaining: z.coerce
    .number({ message: "Informe quantas parcelas faltam." })
    .int("Parcelas são um número inteiro.")
    .min(1, "Falta pelo menos uma parcela.")
    .max(600, "Mais de 600 parcelas não parece certo."),
  /** % ao mês, aceita vírgula ("9,5"). */
  monthlyRatePct: moneySchema.refine((v) => v.gte(0) && v.lte(50), "Juro ao mês entre 0% e 50%."),
});

const toData = (p: z.output<typeof debtSchema>) => ({
  name: p.name,
  installment: decimalToDb(p.installment),
  remaining: p.remaining,
  monthlyRatePct: p.monthlyRatePct.toFixed(3),
});

export async function createDebt(input: z.input<typeof debtSchema>): Promise<ActionResult> {
  return runAction(async () => {
    await prisma.debt.create({ data: toData(debtSchema.parse(input)) });
    revalidateDashboard();
    return undefined;
  });
}

const updateSchema = debtSchema.extend({ id: z.string().uuid() });

export async function updateDebt(input: z.input<typeof updateSchema>): Promise<ActionResult> {
  return runAction(async () => {
    const parsed = updateSchema.parse(input);
    await prisma.debt.update({ where: { id: parsed.id }, data: toData(parsed) });
    revalidateDashboard();
    return undefined;
  });
}

const idSchema = z.object({ id: z.string().uuid() });

/**
 * Registra uma parcela paga: falta uma a menos. Na última, a dívida sai da
 * lista (quitada). Atômico para dois cliques não descontarem duas vezes além do zero.
 */
export async function payInstallment(input: z.input<typeof idSchema>): Promise<ActionResult<{ paidOff: boolean }>> {
  return runAction(async () => {
    const { id } = idSchema.parse(input);
    const paidOff = await prisma.$transaction(async (tx) => {
      const debt = await tx.debt.findUnique({ where: { id } });
      if (!debt) throw new UserFacingError("Essa dívida não existe mais.");
      if (debt.remaining <= 1) {
        await tx.debt.delete({ where: { id } });
        return true;
      }
      await tx.debt.update({ where: { id }, data: { remaining: { decrement: 1 } } });
      return false;
    });
    revalidateDashboard();
    return { paidOff };
  });
}

export async function deleteDebt(input: z.input<typeof idSchema>): Promise<ActionResult> {
  return runAction(async () => {
    const { id } = idSchema.parse(input);
    await prisma.debt.delete({ where: { id } });
    revalidateDashboard();
    return undefined;
  });
}
