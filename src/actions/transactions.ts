"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { decimalToDb, moneySchema, toDecimal } from "@/lib/money";
import { computeReconciliationHash, normalizeDescription } from "@/lib/financial-engine/reconciliation";
import { revalidateDashboard } from "@/lib/revalidate";
import { assertAuthorized } from "@/lib/auth";
import { DomainError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit";

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
  await assertAuthorized();
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
  await assertAuthorized();
  const parsed = updateTransactionSchema.parse(input);

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.transaction.findUniqueOrThrow({
      where: { id: parsed.id },
      include: { invoiceSettlementFor: { select: { id: true } } },
    });

    if (existing.transferId) {
      throw new DomainError(
        "Esta transação faz parte de uma transferência — edite-a por transfers.ts.",
      );
    }
    if (existing.creditCardInvoiceId) {
      throw new DomainError(
        "Esta transação pertence a uma fatura de cartão — não pode ser editada isoladamente.",
      );
    }
    if (existing.invoiceSettlementFor) {
      throw new DomainError(
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

    const updated = await tx.transaction.update({
      where: { id: parsed.id },
      data: {
        accountId: nextAccountId,
        categoryId: parsed.categoryId ?? existing.categoryId,
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
  await assertAuthorized();
  const { id } = deleteTransactionSchema.parse(input);

  await prisma.$transaction(async (tx) => {
    const existing = await tx.transaction.findUniqueOrThrow({
      where: { id },
      include: { invoiceSettlementFor: { select: { id: true } } },
    });

    if (existing.transferId) {
      throw new DomainError(
        "Esta transação faz parte de uma transferência — exclua a transferência inteira.",
      );
    }
    if (existing.creditCardInvoiceId) {
      throw new DomainError(
        "Esta transação pertence a uma fatura de cartão — não pode ser excluída isoladamente.",
      );
    }
    if (existing.invoiceSettlementFor) {
      throw new DomainError(
        "Esta transação liquidou uma fatura — não pode ser excluída isoladamente.",
      );
    }

    await tx.transaction.delete({ where: { id } });
    await tx.account.update({
      where: { id: existing.accountId },
      data: { currentBalance: { decrement: existing.amount } },
    });

    await recordAudit(tx, {
      action: "transaction.delete",
      entityType: "Transaction",
      entityId: id,
      payload: {
        accountId: existing.accountId,
        amount: existing.amount.toString(),
        description: existing.description,
      },
    });
  });

  revalidateDashboard();
}

/**
 * Exclui várias transações em UMA única transação de banco: carrega e
 * valida todas primeiro (qualquer violação aborta tudo — nunca exclui
 * parcialmente), depois deleta em lote e ajusta o saldo de cada conta pelo
 * somatório das transações excluídas daquela conta.
 */
export async function deleteTransactions(input: { ids: string[] }) {
  await assertAuthorized();
  const { ids } = z.object({ ids: z.array(z.string().uuid()).min(1) }).parse(input);

  await prisma.$transaction(async (tx) => {
    const existing = await tx.transaction.findMany({
      where: { id: { in: ids } },
      include: { invoiceSettlementFor: { select: { id: true } } },
    });

    if (existing.length !== ids.length) {
      throw new DomainError(
        `${ids.length - existing.length} de ${ids.length} transação(ões) não foi(foram) encontrada(s). Nada foi excluído.`,
      );
    }

    const blocked = existing.find(
      (t) => t.transferId || t.creditCardInvoiceId || t.invoiceSettlementFor,
    );
    if (blocked) {
      throw new DomainError(
        `A transação "${blocked.description}" está vinculada a transferência/fatura e não pode ser excluída isoladamente. Nada foi excluído.`,
      );
    }

    // Saldo: agrupa o delta por conta (uma atualização por conta afetada).
    const deltaByAccount = new Map<string, ReturnType<typeof toDecimal>>();
    for (const t of existing) {
      const current = deltaByAccount.get(t.accountId) ?? toDecimal(0);
      deltaByAccount.set(t.accountId, current.plus(t.amount.toString()));
    }

    await tx.transaction.deleteMany({ where: { id: { in: ids } } });

    for (const [accountId, total] of deltaByAccount) {
      await tx.account.update({
        where: { id: accountId },
        data: { currentBalance: { decrement: decimalToDb(total) } },
      });
    }

    await recordAudit(tx, {
      action: "transaction.deleteMany",
      entityType: "Transaction",
      payload: {
        ids,
        count: existing.length,
        accounts: Array.from(deltaByAccount.keys()),
      },
    });
  });

  revalidateDashboard();
}

const setCategorySchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
  categoryId: z.string().uuid().nullable(),
});

/** Recategoriza em lote — não afeta saldo (categoria é apenas metadado de relatório). */
export async function setTransactionsCategory(input: z.infer<typeof setCategorySchema>) {
  await assertAuthorized();
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
  await assertAuthorized();
  const { ids, isReconciled } = setReconciledSchema.parse(input);
  await prisma.transaction.updateMany({ where: { id: { in: ids } }, data: { isReconciled } });
  revalidateDashboard();
}
