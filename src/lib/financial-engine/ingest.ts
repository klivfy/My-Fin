import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { toDecimal } from "@/lib/money";
import { hashTransactions, partitionByExistingHash } from "./reconciliation";
import { matchCategory } from "./category-rules";
import type { NormalizedTransaction } from "./financial-adapter";

/**
 * Persistência compartilhada de ingestão (OFX/CSV/Inter): deduplica contra
 * o histórico, aplica as regras de categorização automática e insere em
 * lote dentro de uma única transação de banco junto com o ajuste de saldo.
 */
export async function persistNormalizedTransactions(input: {
  accountId: string;
  normalized: NormalizedTransaction[];
  syncLogId: string;
}): Promise<{ inserted: number; skipped: number }> {
  const { accountId, normalized, syncLogId } = input;
  const hashed = hashTransactions(accountId, normalized);
  const { toInsert, duplicates } = await partitionByExistingHash(hashed);

  if (toInsert.length === 0) return { inserted: 0, skipped: duplicates.length };

  // Regras de categorização: maior prioridade primeiro.
  const rules = await prisma.categoryRule.findMany({
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    select: { pattern: true, categoryId: true },
  });

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.transaction.createMany({
      data: toInsert.map((t) => ({
        accountId,
        categoryId: matchCategory(t.description, rules),
        amount: t.amount.toFixed(2),
        type: t.amount.isNegative() ? ("EXPENSE" as const) : ("INCOME" as const),
        description: t.description,
        originalDescription: t.originalDescription,
        date: t.date,
        isPaid: true,
        isReconciled: false,
        reconciliationHash: t.reconciliationHash,
        syncLogId,
      })),
    });

    const totalInserted = toInsert.reduce((sum, t) => sum.plus(t.amount), toDecimal(0));
    await tx.account.update({
      where: { id: accountId },
      data: { currentBalance: { increment: totalInserted.toFixed(2) } },
    });
  });

  return { inserted: toInsert.length, skipped: duplicates.length };
}
