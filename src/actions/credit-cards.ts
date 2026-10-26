"use server";

import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { Prisma, Transaction } from "@prisma/client";
import { decimalToDb, moneySchema, toDecimal } from "@/lib/money";
import { computeReconciliationHash } from "@/lib/financial-engine/reconciliation";
import { revalidateDashboard } from "@/lib/revalidate";
import { assertAuthorized } from "@/lib/auth";
import { DomainError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit";
import { invoiceCycleOf, parseAccountMetadata, type InvoiceCycle } from "@/lib/account-metadata";

type TxClient = Prisma.TransactionClient;

/**
 * Ciclo de fatura: por padrão fecha no dia 25 e vence no dia 5 do mês
 * seguinte, mas cada cartão pode sobrescrever via `Account.metadata`
 * (`closingDay`/`dueDay`, 1–28 — validados por Zod em
 * `src/lib/account-metadata.ts`). O fechamento SEMPRE ocorre antes do
 * vencimento dentro do ciclo mensal.
 */
async function getInvoiceCycle(tx: TxClient, accountId: string): Promise<InvoiceCycle> {
  const account = await tx.account.findUniqueOrThrow({
    where: { id: accountId },
    select: { metadata: true },
  });
  return invoiceCycleOf(parseAccountMetadata(account.metadata));
}

function invoiceWindowForMonth(
  cycle: InvoiceCycle,
  year: number,
  monthIndex: number,
): { closingDate: Date; dueDate: Date } {
  const closingDate = new Date(Date.UTC(year, monthIndex, cycle.closingDay));
  // Vencimento no mês seguinte ao fechamento quando dueDay <= closingDay
  // (caso comum: fecha 25, vence 5); senão, no mesmo mês.
  const dueMonthOffset = cycle.dueDay <= cycle.closingDay ? 1 : 0;
  const dueDate = new Date(Date.UTC(year, monthIndex + dueMonthOffset, cycle.dueDay));
  return { closingDate, dueDate };
}

/** Em qual mês de fatura uma compra feita em `date` cai, deslocada `monthsAhead` parcelas à frente. */
function invoiceWindowForPurchase(cycle: InvoiceCycle, date: Date, monthsAhead: number) {
  const rolledPastClosing = date.getUTCDate() > cycle.closingDay ? 1 : 0;
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + rolledPastClosing + monthsAhead;
  return invoiceWindowForMonth(cycle, year, month);
}

async function getOrCreateInvoice(tx: TxClient, accountId: string, closingDate: Date, dueDate: Date) {
  return tx.creditCardInvoice.upsert({
    where: { accountId_closingDate: { accountId, closingDate } },
    create: { accountId, closingDate, dueDate, totalAmount: "0.00", status: "OPEN" },
    update: {},
  });
}

const createInstallmentPurchaseSchema = z.object({
  accountId: z.string().uuid(),
  categoryId: z.string().uuid().nullable().optional(),
  totalAmount: moneySchema,
  description: z.string().trim().min(1),
  date: z.coerce.date(),
  totalInstallments: z.number().int().min(1).max(48),
});

export type CreateInstallmentPurchaseInput = z.input<typeof createInstallmentPurchaseSchema>;

/**
 * Lança uma compra parcelada no cartão: gera as N transações filhas
 * (parcela 1/N .. N/N), cada uma vinculada à fatura (`CreditCardInvoice`)
 * em que efetivamente vai cair — a 1ª pode já estourar o fechamento do
 * mês corrente e cair na fatura seguinte, e cada parcela subsequente avança
 * exatamente uma fatura. O valor total é distribuído em parcelas iguais,
 * com o resto de arredondamento absorvido pela última parcela (nunca a
 * primeira — evita cobrar o cliente "adiantado").
 */
export async function createInstallmentPurchase(input: CreateInstallmentPurchaseInput) {
  await assertAuthorized();
  const parsed = createInstallmentPurchaseSchema.parse(input);

  const baseInstallment = parsed.totalAmount
    .dividedBy(parsed.totalInstallments)
    .toDecimalPlaces(2, Decimal.ROUND_DOWN);
  const remainder = parsed.totalAmount.minus(baseInstallment.times(parsed.totalInstallments));

  const created = await prisma.$transaction(async (tx) => {
    const cycle = await getInvoiceCycle(tx, parsed.accountId);
    let parentId: string | null = null;
    const installmentTransactions: Transaction[] = [];

    for (let i = 0; i < parsed.totalInstallments; i += 1) {
      const isLast = i === parsed.totalInstallments - 1;
      const installmentAmount = isLast ? baseInstallment.plus(remainder) : baseInstallment;

      const { closingDate, dueDate } = invoiceWindowForPurchase(cycle, parsed.date, i);
      const invoice = await getOrCreateInvoice(tx, parsed.accountId, closingDate, dueDate);

      const installmentTransaction: Transaction = await tx.transaction.create({
        data: {
          accountId: parsed.accountId,
          categoryId: parsed.categoryId ?? null,
          amount: decimalToDb(installmentAmount.negated()),
          type: "EXPENSE",
          description: `${parsed.description} (${i + 1}/${parsed.totalInstallments})`,
          originalDescription: parsed.description,
          date: closingDate,
          isPaid: false,
          isReconciled: false,
          installmentNumber: i + 1,
          totalInstallments: parsed.totalInstallments,
          parentTransactionId: parentId,
          creditCardInvoiceId: invoice.id,
          reconciliationHash: computeReconciliationHash({
            accountId: parsed.accountId,
            date: closingDate,
            amount: installmentAmount.negated(),
            description: `${parsed.description} ${i + 1}/${parsed.totalInstallments}`,
            fitId: randomUUID(),
          }),
        },
      });

      if (i === 0) parentId = installmentTransaction.id;
      installmentTransactions.push(installmentTransaction);

      await tx.creditCardInvoice.update({
        where: { id: invoice.id },
        data: { totalAmount: { increment: decimalToDb(installmentAmount) } },
      });

      // Débito integral reconhecido no ato da compra (convenção adotada:
      // `currentBalance` de uma conta CREDIT_CARD é o total já comprometido
      // em faturas presentes e futuras, não apenas o já vencido).
      await tx.account.update({
        where: { id: parsed.accountId },
        data: { currentBalance: { decrement: decimalToDb(installmentAmount) } },
      });
    }

    return installmentTransactions;
  });

  revalidateDashboard();
  return created;
}

const reverseSettlementSchema = z.object({ invoiceId: z.string().uuid() });

/**
 * Estorna a liquidação de uma fatura: cria o lançamento de estorno
 * (ADJUSTMENT positivo na conta pagadora), devolve o comprometimento ao
 * saldo do cartão, desmarca as parcelas como pagas e reabre a fatura.
 * A transação de liquidação original é preservada (trilha), mas desvinculada.
 */
export async function reverseInvoiceSettlement(input: z.infer<typeof reverseSettlementSchema>) {
  await assertAuthorized();
  const parsed = reverseSettlementSchema.parse(input);

  const reversal = await prisma.$transaction(async (tx) => {
    const invoice = await tx.creditCardInvoice.findUniqueOrThrow({
      where: { id: parsed.invoiceId },
      include: { settlementTransaction: true },
    });
    if (invoice.status !== "PAID" || !invoice.settlementTransaction) {
      throw new DomainError("Esta fatura não está liquidada — nada a estornar.");
    }

    const settlement = invoice.settlementTransaction;
    const totalAmount = toDecimal(invoice.totalAmount.toString());

    // Estorno: lançamento inverso na conta que pagou (crédito de volta).
    const reversalTransaction = await tx.transaction.create({
      data: {
        accountId: settlement.accountId,
        amount: decimalToDb(totalAmount),
        type: "ADJUSTMENT",
        description: "Estorno de pagamento de fatura de cartão de crédito",
        originalDescription: `Estorno pagamento fatura ${invoice.id}`,
        date: new Date(),
        isPaid: true,
        isReconciled: true,
        reconciliationHash: computeReconciliationHash({
          accountId: settlement.accountId,
          date: new Date(),
          amount: totalAmount,
          description: `Estorno pagamento fatura ${invoice.id}`,
          fitId: randomUUID(),
        }),
      },
    });

    await tx.account.update({
      where: { id: settlement.accountId },
      data: { currentBalance: { increment: decimalToDb(totalAmount) } },
    });
    await tx.account.update({
      where: { id: invoice.accountId },
      data: { currentBalance: { decrement: decimalToDb(totalAmount) } },
    });

    await tx.transaction.updateMany({
      where: { creditCardInvoiceId: invoice.id },
      data: { isPaid: false },
    });

    // Reabre a fatura e desvincula a liquidação (que permanece no extrato
    // da conta pagadora como registro histórico).
    await tx.creditCardInvoice.update({
      where: { id: invoice.id },
      data: { status: "OPEN", settlementTransactionId: null },
    });

    await recordAudit(tx, {
      action: "invoice.reverseSettlement",
      entityType: "CreditCardInvoice",
      entityId: invoice.id,
      payload: {
        settlementTransactionId: settlement.id,
        reversalTransactionId: reversalTransaction.id,
        totalAmount: totalAmount.toFixed(2),
      },
    });

    return reversalTransaction;
  });

  revalidateDashboard();
  return reversal;
}

const adjustRemainingInstallmentsSchema = z.object({
  rootTransactionId: z.string().uuid(),
  /** Novo valor de CADA parcela restante (positivo; o sinal é aplicado pela regra de domínio). */
  newInstallmentAmount: moneySchema.refine((v) => v.isPositive(), "O valor da parcela deve ser positivo."),
});

/**
 * Ajusta o valor das parcelas RESTANTES (isPaid = false) de um parcelamento:
 * recalcula os totais das faturas futuras afetadas e corrige o saldo
 * comprometido do cartão pelo delta — tudo na mesma transação de banco.
 * Parcelas já pagas/liquidadas nunca são tocadas.
 */
export async function adjustRemainingInstallments(input: z.input<typeof adjustRemainingInstallmentsSchema>) {
  await assertAuthorized();
  const parsed = adjustRemainingInstallmentsSchema.parse(input);

  const result = await prisma.$transaction(async (tx) => {
    const root = await tx.transaction.findUniqueOrThrow({
      where: { id: parsed.rootTransactionId },
    });
    if (!root.totalInstallments || root.type !== "EXPENSE") {
      throw new DomainError("Esta transação não é um parcelamento.");
    }

    const rootId = root.parentTransactionId ?? root.id;
    const legs = await tx.transaction.findMany({
      where: {
        OR: [{ id: rootId }, { parentTransactionId: rootId }],
        isPaid: false,
        // Parcelas de faturas já liquidadas não podem ser alteradas.
        creditCardInvoice: { status: { not: "PAID" } },
      },
      include: { creditCardInvoice: { select: { id: true } } },
    });

    if (legs.length === 0) {
      throw new DomainError("Não há parcelas pendentes para ajustar.");
    }

    const newAmount = parsed.newInstallmentAmount.abs().negated();
    let cardDelta = new Decimal(0);
    const invoiceDelta = new Map<string, Decimal>();

    for (const leg of legs) {
      const oldAbs = toDecimal(leg.amount.toString()).abs();
      const diff = parsed.newInstallmentAmount.abs().minus(oldAbs);
      if (diff.isZero()) continue;

      await tx.transaction.update({
        where: { id: leg.id },
        data: { amount: decimalToDb(newAmount) },
      });
      // Cartão: saldo negativo = dívida. Parcela maior → saldo mais negativo.
      cardDelta = cardDelta.minus(diff);
      if (leg.creditCardInvoiceId) {
        const prev = invoiceDelta.get(leg.creditCardInvoiceId) ?? new Decimal(0);
        invoiceDelta.set(leg.creditCardInvoiceId, prev.plus(diff));
      }
    }

    if (!cardDelta.isZero()) {
      await tx.account.update({
        where: { id: root.accountId },
        data: { currentBalance: { increment: decimalToDb(cardDelta) } },
      });
    }
    for (const [invoiceId, delta] of invoiceDelta) {
      await tx.creditCardInvoice.update({
        where: { id: invoiceId },
        data: { totalAmount: { increment: decimalToDb(delta) } },
      });
    }

    await recordAudit(tx, {
      action: "installment.adjustRemaining",
      entityType: "Transaction",
      entityId: rootId,
      payload: {
        adjustedLegs: legs.length,
        newInstallmentAmount: parsed.newInstallmentAmount.toFixed(2),
        cardDelta: cardDelta.toFixed(2),
      },
    });

    return { adjustedLegs: legs.length };
  });

  revalidateDashboard();
  return result;
}

const settleInvoiceSchema = z.object({
  invoiceId: z.string().uuid(),
  payingAccountId: z.string().uuid(),
  paymentDate: z.coerce.date(),
});

export type SettleInvoiceInput = z.input<typeof settleInvoiceSchema>;

/**
 * Liquida uma fatura: debita o valor total da conta pagadora (conta
 * corrente), reduz o saldo comprometido do cartão (restaurando patrimônio
 * líquido) e fecha a fatura como PAID. Usa o tipo ADJUSTMENT — não
 * EXPENSE — porque a despesa já foi reconhecida no somatório mensal no
 * momento de cada compra parcelada; contá-la de novo aqui duplicaria o
 * gasto no relatório de fluxo de caixa.
 */
export async function settleInvoice(input: SettleInvoiceInput) {
  await assertAuthorized();
  const parsed = settleInvoiceSchema.parse(input);

  const settlement = await prisma.$transaction(async (tx) => {
    const invoice = await tx.creditCardInvoice.findUniqueOrThrow({ where: { id: parsed.invoiceId } });
    if (invoice.status === "PAID") {
      throw new DomainError("Esta fatura já está liquidada.");
    }
    if (parsed.payingAccountId === invoice.accountId) {
      throw new DomainError("A conta pagadora deve ser diferente do cartão da fatura.");
    }

    const payer = await tx.account.findUniqueOrThrow({ where: { id: parsed.payingAccountId } });
    if (!payer.isActive) {
      throw new DomainError("A conta pagadora está inativa.");
    }
    if (payer.type === "CREDIT_CARD") {
      throw new DomainError("A conta pagadora não pode ser um cartão de crédito.");
    }

    const totalAmount = toDecimal(invoice.totalAmount.toString());

    const settlementTransaction = await tx.transaction.create({
      data: {
        accountId: parsed.payingAccountId,
        amount: decimalToDb(totalAmount.negated()),
        type: "ADJUSTMENT",
        description: "Pagamento de fatura de cartão de crédito",
        originalDescription: `Pagamento fatura ${invoice.id}`,
        date: parsed.paymentDate,
        isPaid: true,
        isReconciled: true,
        reconciliationHash: computeReconciliationHash({
          accountId: parsed.payingAccountId,
          date: parsed.paymentDate,
          amount: totalAmount.negated(),
          description: `Pagamento fatura ${invoice.id}`,
          fitId: randomUUID(),
        }),
      },
    });

    // Caixa ↓ e dívida do cartão ↑ (currentBalance menos negativo): patrimônio
    // líquido permanece estável.
    await tx.account.update({
      where: { id: parsed.payingAccountId },
      data: { currentBalance: { decrement: decimalToDb(totalAmount) } },
    });
    await tx.account.update({
      where: { id: invoice.accountId },
      data: { currentBalance: { increment: decimalToDb(totalAmount) } },
    });

    await tx.transaction.updateMany({
      where: { creditCardInvoiceId: invoice.id },
      data: { isPaid: true },
    });

    await tx.creditCardInvoice.update({
      where: { id: invoice.id },
      data: { status: "PAID", settlementTransactionId: settlementTransaction.id },
    });

    await recordAudit(tx, {
      action: "invoice.settle",
      entityType: "CreditCardInvoice",
      entityId: invoice.id,
      payload: {
        payingAccountId: parsed.payingAccountId,
        totalAmount: invoice.totalAmount.toString(),
        paymentDate: parsed.paymentDate.toISOString(),
      },
    });

    return settlementTransaction;
  });

  revalidateDashboard();
  return settlement;
}
