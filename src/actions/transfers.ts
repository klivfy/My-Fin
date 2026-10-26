"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { decimalToDb, moneySchema } from "@/lib/money";
import { computeReconciliationHash } from "@/lib/financial-engine/reconciliation";
import { revalidateDashboard } from "@/lib/revalidate";
import { assertAuthorized } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";

const createTransferSchema = z
  .object({
    sourceAccountId: z.string().uuid(),
    destinationAccountId: z.string().uuid(),
    amount: moneySchema,
    date: z.coerce.date(),
    description: z.string().trim().min(1).default("Transferência entre contas"),
  })
  .refine((data) => data.sourceAccountId !== data.destinationAccountId, {
    message: "A conta de origem e destino não podem ser a mesma.",
    path: ["destinationAccountId"],
  })
  .refine((data) => data.amount.isPositive(), {
    message: "O valor da transferência deve ser positivo.",
    path: ["amount"],
  });

export type CreateTransferInput = z.input<typeof createTransferSchema>;

/**
 * Transferência atômica entre duas contas próprias: partida dobrada real
 * (débito na origem + crédito no destino), ambas do tipo TRANSFER — o que
 * as exclui automaticamente de qualquer somatório de receita/despesa do
 * mês (esses relatórios filtram `type IN (INCOME, EXPENSE)`). Tudo roda
 * dentro de um único `prisma.$transaction`: se qualquer passo falhar, nada
 * é persistido.
 */
export async function createTransfer(input: CreateTransferInput) {
  await assertAuthorized();
  const parsed = createTransferSchema.parse(input);
  const amountDb = decimalToDb(parsed.amount);

  const transfer = await prisma.$transaction(async (tx) => {
    const [sourceAccount, destinationAccount] = await Promise.all([
      tx.account.findUniqueOrThrow({ where: { id: parsed.sourceAccountId } }),
      tx.account.findUniqueOrThrow({ where: { id: parsed.destinationAccountId } }),
    ]);

    const debitLeg = await tx.transaction.create({
      data: {
        accountId: sourceAccount.id,
        amount: decimalToDb(parsed.amount.negated()),
        type: "TRANSFER",
        description: `Transferência enviada para ${destinationAccount.name}`,
        originalDescription: parsed.description,
        date: parsed.date,
        isPaid: true,
        isReconciled: true,
        reconciliationHash: computeReconciliationHash({
          accountId: sourceAccount.id,
          date: parsed.date,
          amount: parsed.amount.negated(),
          description: parsed.description,
          fitId: randomUUID(),
        }),
      },
    });

    const creditLeg = await tx.transaction.create({
      data: {
        accountId: destinationAccount.id,
        amount: amountDb,
        type: "TRANSFER",
        description: `Transferência recebida de ${sourceAccount.name}`,
        originalDescription: parsed.description,
        date: parsed.date,
        isPaid: true,
        isReconciled: true,
        reconciliationHash: computeReconciliationHash({
          accountId: destinationAccount.id,
          date: parsed.date,
          amount: parsed.amount,
          description: parsed.description,
          fitId: randomUUID(),
        }),
      },
    });

    const createdTransfer = await tx.transfer.create({
      data: {
        sourceAccountId: sourceAccount.id,
        destinationAccountId: destinationAccount.id,
        sourceTransactionId: debitLeg.id,
        destinationTransactionId: creditLeg.id,
        amount: amountDb,
        date: parsed.date,
      },
    });

    await tx.transaction.update({
      where: { id: debitLeg.id },
      data: { transferId: createdTransfer.id },
    });
    await tx.transaction.update({
      where: { id: creditLeg.id },
      data: { transferId: createdTransfer.id },
    });

    await tx.account.update({
      where: { id: sourceAccount.id },
      data: { currentBalance: { decrement: amountDb } },
    });
    await tx.account.update({
      where: { id: destinationAccount.id },
      data: { currentBalance: { increment: amountDb } },
    });

    return createdTransfer;
  });

  revalidateDashboard();
  return transfer;
}

const deleteTransferSchema = z.object({ id: z.string().uuid() });

/** Reverte uma transferência: exclui as duas pernas e desfaz o efeito no saldo. */
export async function deleteTransfer(input: z.infer<typeof deleteTransferSchema>) {
  await assertAuthorized();
  const { id } = deleteTransferSchema.parse(input);

  await prisma.$transaction(async (tx) => {
    const transfer = await tx.transfer.findUniqueOrThrow({ where: { id } });

    await tx.transaction.deleteMany({ where: { transferId: id } });
    await tx.transfer.delete({ where: { id } });

    await tx.account.update({
      where: { id: transfer.sourceAccountId },
      data: { currentBalance: { increment: transfer.amount } },
    });
    await tx.account.update({
      where: { id: transfer.destinationAccountId },
      data: { currentBalance: { decrement: transfer.amount } },
    });

    await recordAudit(tx, {
      action: "transfer.delete",
      entityType: "Transfer",
      entityId: id,
      payload: {
        sourceAccountId: transfer.sourceAccountId,
        destinationAccountId: transfer.destinationAccountId,
        amount: transfer.amount.toString(),
      },
    });
  });

  revalidateDashboard();
}
