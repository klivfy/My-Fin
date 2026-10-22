"use server";

import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { invoiceWindowForPurchase, planInstallments, splitInstallments } from "@/lib/credit-card-cycle";
import { decimalToDb, moneySchema, toDecimal } from "@/lib/money";
import { computeReconciliationHash } from "@/lib/financial-engine/reconciliation";
import { revalidateDashboard } from "@/lib/revalidate";

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
 *
 * Tudo é calculado em memória e gravado em lote: o número de consultas não
 * depende do número de parcelas (antes eram ~4 por parcela, ~192 para 48x,
 * perto do timeout de 5 s das transações interativas do Prisma).
 */
export async function createInstallmentPurchase(input: CreateInstallmentPurchaseInput) {
  const parsed = createInstallmentPurchaseSchema.parse(input);
  const amounts = splitInstallments(parsed.totalAmount, parsed.totalInstallments);
  const total = amounts.reduce((sum, amount) => sum.plus(amount), new Decimal(0));

  const created = await prisma.$transaction(async (tx) => {
    const account = await tx.account.findUnique({
      where: { id: parsed.accountId },
      select: { type: true, isActive: true },
    });
    if (!account) {
      throw new Error("Cartão não encontrado.");
    }
    if (account.type !== "CREDIT_CARD") {
      throw new Error("Compra parcelada só pode ser lançada em conta do tipo cartão de crédito.");
    }
    if (!account.isActive) {
      throw new Error("O cartão está inativo.");
    }

    const paidInvoices = await tx.creditCardInvoice.findMany({
      where: {
        accountId: parsed.accountId,
        status: "PAID",
        closingDate: { gte: invoiceWindowForPurchase(parsed.date, 0).closingDate },
      },
      select: { closingDate: true },
    });
    const plan = planInstallments({
      date: parsed.date,
      amounts,
      paidClosingDates: new Set(paidInvoices.map((invoice) => invoice.closingDate.toISOString())),
    });

    // Cria as faturas que faltam (as existentes ficam como estão).
    await tx.creditCardInvoice.createMany({
      data: plan.map((item) => ({
        accountId: parsed.accountId,
        closingDate: item.closingDate,
        dueDate: item.dueDate,
        totalAmount: "0.00",
        status: "OPEN" as const,
      })),
      skipDuplicates: true,
    });
    const invoices = await tx.creditCardInvoice.findMany({
      where: { accountId: parsed.accountId, closingDate: { in: plan.map((item) => item.closingDate) } },
      select: { id: true, closingDate: true },
    });
    const invoiceIdByClosing = new Map(invoices.map((invoice) => [invoice.closingDate.toISOString(), invoice.id]));
    const invoiceIds = plan.map((item) => invoiceIdByClosing.get(item.closingDate.toISOString())!);

    // Um único UPDATE soma cada parcela à sua fatura, só se ela ainda não
    // foi paga: a condição é reavaliada sob a trava da linha, então um
    // pagamento concorrente nunca recebe valor depois de liquidado.
    const updated = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE "credit_card_invoices" AS i
      SET "totalAmount" = i."totalAmount" + v.amount,
          "updatedAt" = (NOW() AT TIME ZONE 'UTC')
      FROM unnest(${invoiceIds}::text[], ${plan.map((item) => decimalToDb(item.amount))}::numeric[]) AS v(id, amount)
      WHERE i.id = v.id AND i.status <> 'PAID'
      RETURNING i.id`;
    if (updated.length !== plan.length) {
      throw new Error("Uma fatura foi liquidada durante o lançamento. Tente novamente.");
    }

    const parentId = randomUUID();
    const installments = await tx.transaction.createManyAndReturn({
      data: plan.map((item, i) => ({
        id: i === 0 ? parentId : randomUUID(),
        accountId: parsed.accountId,
        categoryId: parsed.categoryId ?? null,
        amount: decimalToDb(item.amount.negated()),
        type: "EXPENSE" as const,
        description: `${parsed.description} (${item.installmentNumber}/${parsed.totalInstallments})`,
        originalDescription: parsed.description,
        date: item.closingDate,
        isPaid: false,
        isReconciled: false,
        installmentNumber: item.installmentNumber,
        totalInstallments: parsed.totalInstallments,
        parentTransactionId: i === 0 ? null : parentId,
        creditCardInvoiceId: invoiceIds[i],
        reconciliationHash: computeReconciliationHash({
          accountId: parsed.accountId,
          date: item.closingDate,
          amount: item.amount.negated(),
          description: `${parsed.description} ${item.installmentNumber}/${parsed.totalInstallments}`,
          fitId: randomUUID(),
        }),
      })),
    });

    // Débito integral reconhecido no ato da compra (convenção adotada:
    // `currentBalance` de uma conta CREDIT_CARD é o total já comprometido
    // em faturas presentes e futuras, não apenas o já vencido).
    await tx.account.update({
      where: { id: parsed.accountId },
      data: { currentBalance: { decrement: decimalToDb(total) } },
    });

    return installments.sort((x, y) => (x.installmentNumber ?? 0) - (y.installmentNumber ?? 0));
  });

  revalidateDashboard();
  return created;
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
  const parsed = settleInvoiceSchema.parse(input);

  const settlement = await prisma.$transaction(async (tx) => {
    // Reivindica a fatura antes de qualquer outra coisa: o UPDATE condicional
    // trava a linha, e um segundo pagamento simultâneo espera este terminar e
    // então não encontra mais a fatura em aberto (count 0). Ler o status e
    // decidir depois deixava os dois passarem e debitava a conta em dobro.
    // Se algo abaixo falhar, o rollback devolve o status anterior.
    const claimed = await tx.creditCardInvoice.updateMany({
      where: { id: parsed.invoiceId, status: { not: "PAID" } },
      data: { status: "PAID" },
    });
    const invoice = await tx.creditCardInvoice.findUniqueOrThrow({ where: { id: parsed.invoiceId } });
    if (claimed.count !== 1) {
      throw new Error("Esta fatura já está liquidada.");
    }
    if (parsed.payingAccountId === invoice.accountId) {
      throw new Error("A conta pagadora deve ser diferente do cartão da fatura.");
    }

    const payer = await tx.account.findUniqueOrThrow({ where: { id: parsed.payingAccountId } });
    if (!payer.isActive) {
      throw new Error("A conta pagadora está inativa.");
    }
    if (payer.type === "CREDIT_CARD") {
      throw new Error("A conta pagadora não pode ser um cartão de crédito.");
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
      data: { settlementTransactionId: settlementTransaction.id },
    });

    return settlementTransaction;
  });

  revalidateDashboard();
  return settlement;
}
