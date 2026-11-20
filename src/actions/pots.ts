"use server";

import Decimal from "decimal.js";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { moneySchema } from "@/lib/money";
import { revalidateDashboard } from "@/lib/revalidate";
import { runAction, UserFacingError, type ActionResult } from "@/lib/action-result";
import { POT_ORDER, validatePercents, type Percents } from "@/lib/financial-engine/pots";

const percentSchema = z.object(
  Object.fromEntries(POT_ORDER.map((p) => [p, moneySchema])) as Record<(typeof POT_ORDER)[number], typeof moneySchema>,
);

/** Salva os percentuais dos 6 potes. A soma precisa fechar 100%; é tudo ou nada. */
export async function savePotPercents(input: z.input<typeof percentSchema>): Promise<ActionResult> {
  return runAction(async () => {
    const parsed = percentSchema.parse(input);
    const percents = Object.fromEntries(POT_ORDER.map((p) => [p, parsed[p] as Decimal])) as Percents;
    const error = validatePercents(percents);
    if (error) throw new UserFacingError(error);

    await prisma.$transaction(
      POT_ORDER.map((pot) =>
        prisma.potAllocation.upsert({
          where: { pot },
          create: { pot, percent: percents[pot].toFixed(2) },
          update: { percent: percents[pot].toFixed(2) },
        }),
      ),
    );
    revalidateDashboard();
    return undefined;
  });
}

/** Volta ao padrão do método (50/10/10/10/10/10). */
export async function resetPotPercents(): Promise<ActionResult> {
  return runAction(async () => {
    await prisma.potAllocation.deleteMany();
    revalidateDashboard();
    return undefined;
  });
}
