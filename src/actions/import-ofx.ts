"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { OfxAdapter } from "@/lib/financial-engine/ofx-adapter";
import { persistNormalizedTransactions } from "@/lib/financial-engine/ingest";
import { revalidateDashboard } from "@/lib/revalidate";
import { assertAuthorized } from "@/lib/auth";
import { DomainError, safeErrorMessage } from "@/lib/errors";
import { recordAuditStandalone } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { MAX_OFX_FILE_SIZE_BYTES, MAX_OFX_RECORDS } from "@/lib/constants";

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
  await assertAuthorized();
  const { accountId } = importOfxSchema.parse({ accountId: formData.get("accountId") });

  const file = formData.get("file");
  if (!(file instanceof File)) {
    throw new DomainError("Nenhum arquivo OFX foi enviado.");
  }

  // --- Defesas de borda (o cliente também filtra, mas a autoridade é aqui) ---
  if (!file.name.toLowerCase().endsWith(".ofx")) {
    throw new DomainError("Envie um arquivo .ofx.");
  }
  if (file.size > MAX_OFX_FILE_SIZE_BYTES) {
    throw new DomainError(
      `Arquivo muito grande (${(file.size / 1024 / 1024).toFixed(1)} MB). Limite: ${MAX_OFX_FILE_SIZE_BYTES / 1024 / 1024} MB.`,
    );
  }

  // OFX em conta de cartão não é suportado: as convenções de fatura/saldo de
  // CREDIT_CARD (saldo negativo = dívida comprometida) exigem um fluxo próprio
  // com vínculo a faturas. Importar aqui corromperia o saldo do cartão.
  const account = await prisma.account.findUniqueOrThrow({
    where: { id: accountId },
    select: { type: true },
  });
  if (account.type === "CREDIT_CARD") {
    throw new DomainError(
      "Importação OFX não é suportada para cartões de crédito. Lance compras pelo módulo do cartão.",
    );
  }

  const syncLog = await prisma.syncLog.create({
    data: { provider: "OFX_IMPORT", status: "RUNNING" },
  });

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const adapter = new OfxAdapter(buffer);
    const blocks = adapter.parsePayload(undefined);

    if (blocks.length > MAX_OFX_RECORDS) {
      throw new DomainError(
        `O extrato contém ${blocks.length} registros — acima do limite de ${MAX_OFX_RECORDS} por importação. Divida o arquivo.`,
      );
    }

    const normalized = blocks.map((block) => adapter.normalize(block));

    if (normalized.length === 0) {
      await prisma.syncLog.update({
        where: { id: syncLog.id },
        data: { status: "SUCCESS", recordsProcessed: 0, finishedAt: new Date() },
      });
      return { recordsProcessed: 0, recordsInserted: 0, recordsSkipped: 0, syncLogId: syncLog.id };
    }

    const { inserted, skipped } = await persistNormalizedTransactions({
      accountId,
      normalized,
      syncLogId: syncLog.id,
    });

    await prisma.syncLog.update({
      where: { id: syncLog.id },
      data: {
        status: "SUCCESS",
        recordsProcessed: normalized.length,
        recordsInserted: inserted,
        recordsSkipped: skipped,
        finishedAt: new Date(),
      },
    });

    revalidateDashboard();

    await recordAuditStandalone({
      action: "ofx.import",
      entityType: "SyncLog",
      entityId: syncLog.id,
      payload: {
        accountId,
        recordsProcessed: normalized.length,
        recordsInserted: inserted,
        recordsSkipped: skipped,
      },
    });

    return {
      recordsProcessed: normalized.length,
      recordsInserted: inserted,
      recordsSkipped: skipped,
      syncLogId: syncLog.id,
    };
  } catch (error) {
    // Persiste apenas a mensagem segura (erros de domínio) ou uma genérica;
    // o detalhe técnico completo fica no log estruturado do servidor.
    logger.error({ action: "ofx.import", syncLogId: syncLog.id, accountId }, "falha na importação OFX", error);
    await prisma.syncLog.update({
      where: { id: syncLog.id },
      data: {
        status: "FAILED",
        errorDetails: safeErrorMessage(error, "Falha ao processar o arquivo OFX."),
        finishedAt: new Date(),
      },
    });
    throw error;
  }
}
