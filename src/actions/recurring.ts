"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { revalidateDashboard } from "@/lib/revalidate";

const keySchema = z.object({ key: z.string().trim().min(1).max(200) });

/** Marca uma recorrência detectada como "não é recorrente". */
export async function ignoreRecurrence(input: z.input<typeof keySchema>) {
  const { key } = keySchema.parse(input);
  await prisma.recurrenceIgnore.upsert({ where: { key }, create: { key }, update: {} });
  revalidateDashboard();
}

/** Desfaz o "não é recorrente". */
export async function restoreRecurrence(input: z.input<typeof keySchema>) {
  const { key } = keySchema.parse(input);
  await prisma.recurrenceIgnore.deleteMany({ where: { key } });
  revalidateDashboard();
}
