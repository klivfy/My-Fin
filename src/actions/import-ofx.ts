"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { toDecimal } from "@/lib/money";
import { OfxAdapter } from "@/lib/financial-engine/ofx-adapter";
import { hashTransactions, partitionByExistingHash } from "@/lib/financial-engine/reconciliation";
import { matchCategory } from "@/lib/financial-engine/categorization";
import { revalidateDashboard } from "@/lib/revalidate";

const importOfxSchema = z.object({
  accountId: z.string().uuid(),
});

export interface ImportOfxResult {
  recordsProcessed: number;
  recordsInserted: number;
  recordsSkipped: number;
  syncLogId: string;
}

/**
 * Recebe um arquivo `.ofx` (via FormData, tipicamente de um dropzone),
 * processa via `OfxAdapter`, deduplica contra o histórico existente e
 * insere em lote apenas os registros inéditos. Toda execução — sucesso ou
 * falha — fica registrada em `SyncLog` para auditoria.
 */
export async function importOfx(formData: FormData): Promise<ImportOfxResult> {
  const { accountId } = importOfxSchema.parse({ accountId: formData.get("accountId") });

  const file = formData.get("file");
  if (!(file instanceof File)) {
    throw new Error("Nenhum arquivo OFX foi enviado.");
  }

  const syncLog = await prisma.syncLog.create({
    data: { provider: "OFX_IMPORT", status: "RUNNING" },
  });

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const adapter = new OfxAdapter(buffer);
    const blocks = adapter.parsePayload(undefined);
    const normalized = blocks.map((block) => adapter.normalize(block));

    if (normalized.length === 0) {
      await prisma.syncLog.update({
        where: { id: syncLog.id },
        data: { status: "SUCCESS", recordsProcessed: 0, finishedAt: new Date() },
      });
      return { recordsProcessed: 0, recordsInserted: 0, recordsSkipped: 0, syncLogId: syncLog.id };
    }

    const hashed = hashTransactions(accountId, normalized);
    const { toInsert, duplicates } = await partitionByExistingHash(hashed);
    const rules =
      toInsert.length > 0
        ? await prisma.categorizationRule.findMany({ select: { pattern: true, categoryId: true } })
        : [];

    if (toInsert.length > 0) {
      await prisma.$transaction(async (tx) => {
        await tx.transaction.createMany({
          data: toInsert.map((t) => {
            const categoryId = matchCategory(t.description, rules);
            return {
              accountId,
              categoryId,
              categorizationSource: categoryId ? ("RULE" as const) : null,
              amount: t.amount.toFixed(2),
              type: t.amount.isNegative() ? ("EXPENSE" as const) : ("INCOME" as const),
              description: t.description,
              originalDescription: t.originalDescription,
              date: t.date,
              isPaid: true,
              isReconciled: false,
              reconciliationHash: t.reconciliationHash,
              syncLogId: syncLog.id,
            };
          }),
        });

        const totalInserted = toInsert.reduce((sum, t) => sum.plus(t.amount), toDecimal(0));
        await tx.account.update({
          where: { id: accountId },
          data: { currentBalance: { increment: totalInserted.toFixed(2) } },
        });
      });
    }

    await prisma.syncLog.update({
      where: { id: syncLog.id },
      data: {
        status: "SUCCESS",
        recordsProcessed: normalized.length,
        recordsInserted: toInsert.length,
        recordsSkipped: duplicates.length,
        finishedAt: new Date(),
      },
    });

    revalidateDashboard();

    return {
      recordsProcessed: normalized.length,
      recordsInserted: toInsert.length,
      recordsSkipped: duplicates.length,
      syncLogId: syncLog.id,
    };
  } catch (error) {
    await prisma.syncLog.update({
      where: { id: syncLog.id },
      data: {
        status: "FAILED",
        errorDetails: error instanceof Error ? error.message : String(error),
        finishedAt: new Date(),
      },
    });
    throw error;
  }
}
