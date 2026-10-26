"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { CsvAdapter, type CsvColumnMapping } from "@/lib/financial-engine/csv-adapter";
import { persistNormalizedTransactions } from "@/lib/financial-engine/ingest";
import { revalidateDashboard } from "@/lib/revalidate";
import { assertAuthorized } from "@/lib/auth";
import { DomainError, safeErrorMessage } from "@/lib/errors";
import { recordAuditStandalone } from "@/lib/audit";
import { MAX_OFX_FILE_SIZE_BYTES, MAX_OFX_RECORDS } from "@/lib/constants";

const mappingSchema = z.object({
  date: z.number().int().min(0),
  description: z.number().int().min(0),
  amount: z.number().int().min(0).optional(),
  credit: z.number().int().min(0).optional(),
  debit: z.number().int().min(0).optional(),
  dateFormat: z.enum(["dd/mm/yyyy", "yyyy-mm-dd", "mm/dd/yyyy"]),
  amountFormat: z.enum(["br", "intl"]),
  hasHeader: z.boolean().default(true),
});

const importCsvSchema = z.object({
  accountId: z.string().uuid(),
  mapping: mappingSchema,
});

export interface ImportCsvResult {
  recordsProcessed: number;
  recordsInserted: number;
  recordsSkipped: number;
  syncLogId: string;
}

/**
 * Importa um extrato CSV genérico: o usuário mapeia as colunas na UI e o
 * servidor valida tamanho/extensão, parseia com o `CsvAdapter`, deduplica
 * pelo mesmo `reconciliationHash` do OFX e aplica regras de categorização.
 */
export async function importCsv(formData: FormData): Promise<ImportCsvResult> {
  await assertAuthorized();
  const { accountId, mapping } = importCsvSchema.parse({
    accountId: formData.get("accountId"),
    mapping: JSON.parse(String(formData.get("mapping") ?? "{}")),
  });

  if (mapping.amount === undefined && (mapping.credit === undefined || mapping.debit === undefined)) {
    throw new DomainError("Mapeie a coluna de valor (assinado) ou as colunas de crédito e débito.");
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    throw new DomainError("Nenhum arquivo CSV foi enviado.");
  }
  if (!/\.csv$/i.test(file.name)) {
    throw new DomainError("Envie um arquivo .csv.");
  }
  if (file.size > MAX_OFX_FILE_SIZE_BYTES) {
    throw new DomainError(
      `Arquivo muito grande. Limite: ${MAX_OFX_FILE_SIZE_BYTES / 1024 / 1024} MB.`,
    );
  }

  const account = await prisma.account.findUniqueOrThrow({
    where: { id: accountId },
    select: { type: true },
  });
  if (account.type === "CREDIT_CARD") {
    throw new DomainError(
      "Importação de extrato não é suportada para cartões de crédito. Lance compras pelo módulo do cartão.",
    );
  }

  const syncLog = await prisma.syncLog.create({
    data: { provider: "CSV_IMPORT", status: "RUNNING" },
  });

  try {
    const text = await file.text();
    const adapter = new CsvAdapter(text, mapping as CsvColumnMapping);
    const rows = adapter.parsePayload(undefined);

    if (rows.length > MAX_OFX_RECORDS) {
      throw new DomainError(
        `O arquivo contém ${rows.length} linhas — acima do limite de ${MAX_OFX_RECORDS} por importação.`,
      );
    }

    const normalized = rows.map((row) => adapter.normalize(row));
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
      action: "csv.import",
      entityType: "SyncLog",
      entityId: syncLog.id,
      payload: { accountId, recordsProcessed: normalized.length, recordsInserted: inserted, recordsSkipped: skipped },
    });

    return {
      recordsProcessed: normalized.length,
      recordsInserted: inserted,
      recordsSkipped: skipped,
      syncLogId: syncLog.id,
    };
  } catch (error) {
    console.error("[importCsv] falha na importação:", error);
    await prisma.syncLog.update({
      where: { id: syncLog.id },
      data: {
        status: "FAILED",
        errorDetails: safeErrorMessage(error, "Falha ao processar o arquivo CSV."),
        finishedAt: new Date(),
      },
    });
    throw error;
  }
}
