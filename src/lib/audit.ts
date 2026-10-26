import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type TxClient = Prisma.TransactionClient;

export interface AuditEntry {
  /** Verbo da ação, ex.: "transaction.delete", "transfer.delete", "invoice.settle". */
  action: string;
  /** Entidade afetada, ex.: "Transaction", "Transfer", "CreditCardInvoice". */
  entityType: string;
  entityId?: string;
  /** Resumo JSON-safe da operação — nunca segredos nem payloads brutos grandes. */
  payload?: Prisma.InputJsonValue;
}

/**
 * Trilha de auditoria das ações destrutivas/sensíveis. Deve ser chamada
 * DENTRO da mesma `prisma.$transaction` da operação auditada sempre que
 * possível — assim o rastro é atômico com o efeito. Falha na auditoria
 * nunca deve derrubar a operação de negócio: loga no servidor e segue.
 */
export async function recordAudit(tx: TxClient, entry: AuditEntry): Promise<void> {
  try {
    await tx.auditLog.create({
      data: {
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        payload: entry.payload,
      },
    });
  } catch (error) {
    console.error("[audit] falha ao registrar", entry.action, error);
  }
}

/** Variante fora de transação explícita (abre operação autônoma). */
export async function recordAuditStandalone(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        payload: entry.payload,
      },
    });
  } catch (error) {
    console.error("[audit] falha ao registrar", entry.action, error);
  }
}
