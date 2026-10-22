"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { decimalToDb, moneySchema, toDecimal } from "@/lib/money";
import { computeReconciliationHash, normalizeDescription } from "@/lib/financial-engine/reconciliation";
import { revalidateDashboard } from "@/lib/revalidate";

const createTransactionSchema = z.object({
  accountId: z.string().uuid(),
  categoryId: z.string().uuid().nullable().optional(),
  amount: moneySchema,
  type: z.enum(["INCOME", "EXPENSE", "ADJUSTMENT"]),
  description: z.string().trim().min(1, "Descrição obrigatória."),
  date: z.coerce.date(),
  isPaid: z.boolean().default(true),
});

const updateTransactionSchema = createTransactionSchema.partial().extend({
  id: z.string().uuid(),
});

export type CreateTransactionInput = z.input<typeof createTransactionSchema>;
export type UpdateTransactionInput = z.input<typeof updateTransactionSchema>;

/**
 * Cria uma transação manual e atualiza o `currentBalance` da conta na
 * mesma transação de banco (`$transaction`) — nunca em dois passos
 * separados, para não deixar a conta com saldo inconsistente em caso de
 * falha no meio do caminho.
 */
export async function createTransaction(input: CreateTransactionInput) {
  const parsed = createTransactionSchema.parse(input);
  // EXPENSE deve sempre chegar negativo, INCOME sempre positivo — a UI só
  // pergunta o valor absoluto; o sinal é uma regra de domínio, não da tela.
  // ADJUSTMENT é a exceção: uma correção de saldo pode ir em qualquer
  // direção, então o valor assinado informado pelo chamador é respeitado.
  const signedAmount =
    parsed.type === "EXPENSE"
      ? parsed.amount.abs().negated()
      : parsed.type === "INCOME"
        ? parsed.amount.abs()
        : parsed.amount;

  const result = await prisma.$transaction(async (tx) => {
    const transaction = await tx.transaction.create({
      data: {
        accountId: parsed.accountId,
        categoryId: parsed.categoryId ?? null,
        categorizationSource: parsed.categoryId ? "MANUAL" : null,
        amount: decimalToDb(signedAmount),
        type: parsed.type,
        description: normalizeDescription(parsed.description),
        originalDescription: parsed.description,
        date: parsed.date,
        isPaid: parsed.isPaid,
        isReconciled: false,
        reconciliationHash: computeReconciliationHash({
          accountId: parsed.accountId,
          date: parsed.date,
          amount: signedAmount,
          description: parsed.description,
          fitId: randomUUID(),
        }),
      },
    });

    await tx.account.update({
      where: { id: parsed.accountId },
      data: { currentBalance: { increment: decimalToDb(signedAmount) } },
    });

    return transaction;
  });

  revalidateDashboard();
  return result;
}

/**
 * Atualiza uma transação existente. Se o valor ou a conta mudarem, o saldo
 * da conta (antiga e/ou nova) é ajustado pela diferença dentro da mesma
 * transação de banco.
 */
export async function updateTransaction(input: UpdateTransactionInput) {
  const parsed = updateTransactionSchema.parse(input);

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.transaction.findUniqueOrThrow({
      where: { id: parsed.id },
      include: { invoiceSettlementFor: { select: { id: true } } },
    });

    if (existing.transferId) {
      throw new Error(
        "Esta transação faz parte de uma transferência — edite-a por transfers.ts.",
      );
    }
    if (existing.creditCardInvoiceId) {
      throw new Error(
        "Esta transação pertence a uma fatura de cartão — não pode ser editada isoladamente.",
      );
    }
    if (existing.invoiceSettlementFor) {
      throw new Error(
        "Esta transação liquidou uma fatura — não pode ser editada. Estorne pela fatura.",
      );
    }

    const nextType = parsed.type ?? existing.type;
    const nextAccountId = parsed.accountId ?? existing.accountId;
    const rawAmount = parsed.amount ?? toDecimal(existing.amount.toString());
    const nextSignedAmount =
      nextType === "EXPENSE"
        ? rawAmount.abs().negated()
        : nextType === "INCOME"
          ? rawAmount.abs()
          : rawAmount; // ADJUSTMENT: preserva o sinal explícito.

    const nextCategoryId = parsed.categoryId ?? existing.categoryId;
    const categoryChanged = nextCategoryId !== existing.categoryId;

    const updated = await tx.transaction.update({
      where: { id: parsed.id },
      data: {
        accountId: nextAccountId,
        categoryId: nextCategoryId,
        categorizationSource: categoryChanged ? "MANUAL" : existing.categorizationSource,
        amount: decimalToDb(nextSignedAmount),
        type: nextType,
        description: parsed.description ? normalizeDescription(parsed.description) : existing.description,
        originalDescription: parsed.description ?? existing.originalDescription,
        date: parsed.date ?? existing.date,
        isPaid: parsed.isPaid ?? existing.isPaid,
      },
    });

    const oldAmount = toDecimal(existing.amount.toString());

    if (nextAccountId === existing.accountId) {
      const delta = nextSignedAmount.minus(oldAmount);
      if (!delta.isZero()) {
        await tx.account.update({
          where: { id: existing.accountId },
          data: { currentBalance: { increment: decimalToDb(delta) } },
        });
      }
    } else {
      // Mudou de conta: reverte na antiga, aplica integralmente na nova.
      await tx.account.update({
        where: { id: existing.accountId },
        data: { currentBalance: { decrement: decimalToDb(oldAmount) } },
      });
      await tx.account.update({
        where: { id: nextAccountId },
        data: { currentBalance: { increment: decimalToDb(nextSignedAmount) } },
      });
    }

    return updated;
  });

  revalidateDashboard();
  return result;
}

const deleteTransactionSchema = z.object({ id: z.string().uuid() });

/** Exclui uma transação manual e reverte seu efeito no saldo da conta. */
export async function deleteTransaction(input: z.infer<typeof deleteTransactionSchema>) {
  const { id } = deleteTransactionSchema.parse(input);

  await prisma.$transaction(async (tx) => {
    const existing = await tx.transaction.findUniqueOrThrow({
      where: { id },
      include: { invoiceSettlementFor: { select: { id: true } } },
    });

    if (existing.transferId) {
      throw new Error(
        "Esta transação faz parte de uma transferência — exclua a transferência inteira.",
      );
    }
    if (existing.creditCardInvoiceId) {
      throw new Error(
        "Esta transação pertence a uma fatura de cartão — não pode ser excluída isoladamente.",
      );
    }
    if (existing.invoiceSettlementFor) {
      throw new Error(
        "Esta transação liquidou uma fatura — não pode ser excluída isoladamente.",
      );
    }

    await tx.transaction.delete({ where: { id } });
    await tx.account.update({
      where: { id: existing.accountId },
      data: { currentBalance: { decrement: existing.amount } },
    });
  });

  revalidateDashboard();
}

/** Exclui várias transações (reaproveita a validação/reversão de saldo de `deleteTransaction`). */
export async function deleteTransactions(input: { ids: string[] }) {
  const { ids } = z.object({ ids: z.array(z.string().uuid()).min(1) }).parse(input);
  const results = await Promise.allSettled(ids.map((id) => deleteTransaction({ id })));
  const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failed.length > 0) {
    throw new Error(
      `${failed.length} de ${ids.length} transação(ões) não pôde(puderam) ser excluída(s): ` +
        `${failed[0].reason instanceof Error ? failed[0].reason.message : String(failed[0].reason)}`,
    );
  }
}

const setCategorySchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
  categoryId: z.string().uuid().nullable(),
});

/** Recategoriza em lote — não afeta saldo (categoria é apenas metadado de relatório). */
export async function setTransactionsCategory(input: z.infer<typeof setCategorySchema>) {
  const { ids, categoryId } = setCategorySchema.parse(input);
  await prisma.transaction.updateMany({ where: { id: { in: ids } }, data: { categoryId } });
  revalidateDashboard();
}

const setReconciledSchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
  isReconciled: z.boolean(),
});

/** Marca/desmarca conciliação em lote. */
export async function setTransactionsReconciled(input: z.infer<typeof setReconciledSchema>) {
  const { ids, isReconciled } = setReconciledSchema.parse(input);
  await prisma.transaction.updateMany({ where: { id: { in: ids } }, data: { isReconciled } });
  revalidateDashboard();
}
