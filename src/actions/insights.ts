"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { revalidateDashboard } from "@/lib/revalidate";
import { runAction, type ActionResult } from "@/lib/action-result";

// Ids de sugestão: letras, números, dois-pontos e hífen (ex.: alloc:divida:<uuid>).
const dismissSchema = z.object({ id: z.string().regex(/^[a-z0-9:-]{1,80}$/i, "Sugestão inválida.") });

/** Dispensa uma sugestão do painel. Idempotente: dispensar duas vezes não falha. */
export async function dismissInsight(input: z.input<typeof dismissSchema>): Promise<ActionResult> {
  return runAction(async () => {
    const { id } = dismissSchema.parse(input);
    await prisma.insightDismissal.upsert({ where: { id }, create: { id }, update: {} });
    revalidateDashboard();
    return undefined;
  });
}

/** Mostra de novo tudo o que foi dispensado. */
export async function restoreInsights(): Promise<ActionResult> {
  return runAction(async () => {
    await prisma.insightDismissal.deleteMany();
    revalidateDashboard();
    return undefined;
  });
}
