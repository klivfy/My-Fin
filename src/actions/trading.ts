"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { runAction, UserFacingError, type ActionResult } from "@/lib/action-result";
import { DiarioError, parseDiario } from "@/lib/trading/diario";

const MAX_BYTES = 2 * 1024 * 1024;

export interface ImportDiarioResult {
  read: number;
  inserted: number;
  skipped: number;
}

function revalidateTrading() {
  for (const path of ["/", "/trading", "/trading/risco"]) {
    try {
      revalidatePath(path);
    } catch {
      // fora de uma requisição Next (ver lib/revalidate.ts)
    }
  }
}

/**
 * Importa o `diario.csv` do b3-diario. Só acrescenta linhas inéditas
 * (hash da linha); nunca altera nem apaga o que já foi importado.
 */
export async function importDiario(formData: FormData): Promise<ActionResult<ImportDiarioResult>> {
  return runAction(async () => {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) throw new UserFacingError("Escolha o arquivo diario.csv.");
    if (file.size > MAX_BYTES) throw new UserFacingError("Arquivo maior que 2 MB. Confira se é o diario.csv.");

    let rows;
    try {
      rows = parseDiario(await file.text());
    } catch (error) {
      if (error instanceof DiarioError) throw new UserFacingError(error.message);
      throw error;
    }

    const { count } = await prisma.tradeEntry.createMany({
      data: rows.map((r) => ({
        date: new Date(`${r.date}T00:00:00Z`),
        entryDate: r.entryDate ? new Date(`${r.entryDate}T00:00:00Z`) : null,
        ticker: r.ticker,
        assetClass: r.assetClass,
        style: r.style,
        setup: r.setup,
        entryPrice: r.entryPrice?.toFixed(4) ?? null,
        stopPrice: r.stopPrice?.toFixed(4) ?? null,
        targetPrice: r.targetPrice?.toFixed(4) ?? null,
        exitPrice: r.exitPrice?.toFixed(4) ?? null,
        quantity: r.quantity,
        costs: r.costs?.toFixed(2) ?? null,
        resultBrl: r.resultBrl?.toFixed(2) ?? null,
        resultR: r.resultR?.toFixed(3) ?? null,
        exitReason: r.exitReason,
        emotion: r.emotion,
        note: r.note,
        mode: r.mode,
        importHash: r.importHash,
      })),
      skipDuplicates: true,
    });

    revalidateTrading();
    return { read: rows.length, inserted: count, skipped: rows.length - count };
  });
}

const optionalMoney = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v.replace(/\./g, "").replace(",", ".")))
  .refine((v) => v === null || (/^\d+(\.\d{1,2})?$/.test(v) && Number(v) > 0), "Use um valor positivo, como 15,00.");

const optionalInt = (label: string) =>
  z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : Number(v)))
    .refine((v) => v === null || (Number.isInteger(v) && v > 0 && v <= 365), `${label}: use um número inteiro positivo.`);

const limitsSchema = z.object({
  maxLossDay: optionalMoney,
  maxLossMonth: optionalMoney,
  pauseDaysAfterMonth: optionalInt("Pausa"),
  maxTradesDay: optionalInt("Entradas por dia"),
});

/** Grava os limites do perfil (só exibição; quem aplica é o b3-risco com o config.json). */
export async function saveTradeLimits(input: z.input<typeof limitsSchema>): Promise<ActionResult> {
  return runAction(async () => {
    const data = limitsSchema.parse(input);
    await prisma.tradeLimits.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
    revalidateTrading();
    return undefined;
  });
}
