import { strict as assert } from "node:assert";
import { beforeEach, describe, it } from "node:test";
import { createAccount, ledgerDrift, loadPrisma, resetDatabase, skipWithoutDb } from "@/test/db";

async function loadActions() {
  return import("@/actions/credit-cards");
}

describe("cartão de crédito (banco real)", { skip: skipWithoutDb }, () => {
  beforeEach(resetDatabase);

  it("liquida a fatura uma vez só mesmo com pagamentos simultâneos", async () => {
    const prisma = await loadPrisma();
    const { createInstallmentPurchase, settleInvoice } = await loadActions();
    const card = await createAccount({ type: "CREDIT_CARD" });
    const checking = await createAccount({ type: "CHECKING", balance: "5000.00" });

    await createInstallmentPurchase({
      accountId: card.id,
      totalAmount: "300.00",
      description: "Notebook",
      date: new Date(Date.UTC(2025, 0, 10)),
      totalInstallments: 1,
    });
    const invoice = await prisma.creditCardInvoice.findFirstOrThrow({ where: { accountId: card.id } });

    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        settleInvoice({ invoiceId: invoice.id, payingAccountId: checking.id, paymentDate: new Date() }),
      ),
    );

    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const payments = await prisma.transaction.count({ where: { accountId: checking.id } });
    assert.equal(payments, 1);
    const payer = await prisma.account.findUniqueOrThrow({ where: { id: checking.id } });
    assert.equal(payer.currentBalance.toFixed(2), "4700.00");
    const cardAfter = await prisma.account.findUniqueOrThrow({ where: { id: card.id } });
    assert.equal(cardAfter.currentBalance.toFixed(2), "0.00");
    assert.equal(await ledgerDrift(checking.id), "0.00");
  });

  it("recusa liquidar fatura já paga", async () => {
    const prisma = await loadPrisma();
    const { createInstallmentPurchase, settleInvoice } = await loadActions();
    const card = await createAccount({ type: "CREDIT_CARD" });
    const checking = await createAccount({ type: "CHECKING", balance: "1000.00" });
    await createInstallmentPurchase({
      accountId: card.id,
      totalAmount: "100.00",
      description: "Livro",
      date: new Date(Date.UTC(2025, 0, 10)),
      totalInstallments: 1,
    });
    const invoice = await prisma.creditCardInvoice.findFirstOrThrow({ where: { accountId: card.id } });
    const input = { invoiceId: invoice.id, payingAccountId: checking.id, paymentDate: new Date() };

    await settleInvoice(input);
    await assert.rejects(settleInvoice(input), /já está liquidada/);
  });

  it("compra parcelada não entra em fatura já paga: vai para a próxima aberta", async () => {
    const prisma = await loadPrisma();
    const { createInstallmentPurchase, settleInvoice } = await loadActions();
    const card = await createAccount({ type: "CREDIT_CARD" });
    const checking = await createAccount({ type: "CHECKING", balance: "1000.00" });

    // Fatura de janeiro/2025 (fecha 25/01) liquidada.
    await createInstallmentPurchase({
      accountId: card.id,
      totalAmount: "50.00",
      description: "Café",
      date: new Date(Date.UTC(2025, 0, 5)),
      totalInstallments: 1,
    });
    const january = await prisma.creditCardInvoice.findFirstOrThrow({ where: { accountId: card.id } });
    await settleInvoice({ invoiceId: january.id, payingAccountId: checking.id, paymentDate: new Date() });

    // Compra lançada depois, com data dentro da janela de janeiro.
    await createInstallmentPurchase({
      accountId: card.id,
      totalAmount: "90.00",
      description: "Tênis",
      date: new Date(Date.UTC(2025, 0, 20)),
      totalInstallments: 3,
    });

    const januaryAfter = await prisma.creditCardInvoice.findUniqueOrThrow({ where: { id: january.id } });
    assert.equal(januaryAfter.totalAmount.toFixed(2), "50.00");
    assert.equal(januaryAfter.status, "PAID");

    const installments = await prisma.transaction.findMany({
      where: { accountId: card.id, originalDescription: "Tênis" },
      include: { creditCardInvoice: true },
      orderBy: { installmentNumber: "asc" },
    });
    assert.deepEqual(
      installments.map((t) => t.creditCardInvoice?.closingDate.toISOString().slice(0, 10)),
      ["2025-02-25", "2025-03-25", "2025-04-25"],
    );
    assert.ok(installments.every((t) => t.creditCardInvoice?.status === "OPEN"));
  });

  it("parcelamento em 48x: uma fatura por mês, totais e saldo do cartão corretos", async () => {
    const prisma = await loadPrisma();
    const { createInstallmentPurchase } = await loadActions();
    const card = await createAccount({ type: "CREDIT_CARD" });

    const installments = await createInstallmentPurchase({
      accountId: card.id,
      totalAmount: "1000.00",
      description: "Geladeira",
      date: new Date(Date.UTC(2025, 0, 26)),
      totalInstallments: 48,
    });

    assert.equal(installments.length, 48);
    assert.deepEqual(
      installments.map((t) => t.installmentNumber),
      Array.from({ length: 48 }, (_, i) => i + 1),
    );
    const parentId = installments[0].id;
    assert.equal(installments[0].parentTransactionId, null);
    assert.ok(installments.slice(1).every((t) => t.parentTransactionId === parentId));
    assert.equal(installments[0].date.toISOString().slice(0, 10), "2025-02-25");
    assert.equal(installments[47].date.toISOString().slice(0, 10), "2029-01-25");
    assert.equal(installments[47].amount.toFixed(2), "-20.99");

    const invoices = await prisma.creditCardInvoice.findMany({ where: { accountId: card.id } });
    assert.equal(invoices.length, 48);
    const invoiceTotal = invoices.reduce((sum, i) => sum + Number(i.totalAmount), 0);
    assert.equal(invoiceTotal.toFixed(2), "1000.00");
    const cardAfter = await prisma.account.findUniqueOrThrow({ where: { id: card.id } });
    assert.equal(cardAfter.currentBalance.toFixed(2), "-1000.00");
    assert.equal(await ledgerDrift(card.id), "0.00");
  });

  it("compras simultâneas no mesmo cartão somam nas mesmas faturas", async () => {
    const prisma = await loadPrisma();
    const { createInstallmentPurchase } = await loadActions();
    const card = await createAccount({ type: "CREDIT_CARD" });
    const date = new Date(Date.UTC(2025, 0, 10));

    await Promise.all([
      createInstallmentPurchase({ accountId: card.id, totalAmount: "30.00", description: "A", date, totalInstallments: 3 }),
      createInstallmentPurchase({ accountId: card.id, totalAmount: "60.00", description: "B", date, totalInstallments: 3 }),
    ]);

    const invoices = await prisma.creditCardInvoice.findMany({
      where: { accountId: card.id },
      orderBy: { closingDate: "asc" },
    });
    assert.deepEqual(
      invoices.map((i) => i.totalAmount.toFixed(2)),
      ["30.00", "30.00", "30.00"],
    );
  });

  it("recusa compra parcelada em conta que não é cartão", async () => {
    const prisma = await loadPrisma();
    const { createInstallmentPurchase } = await loadActions();
    const checking = await createAccount({ type: "CHECKING", balance: "100.00" });

    await assert.rejects(
      createInstallmentPurchase({
        accountId: checking.id,
        totalAmount: "50.00",
        description: "Errado",
        date: new Date(Date.UTC(2025, 0, 10)),
        totalInstallments: 2,
      }),
      /cartão de crédito/,
    );
    assert.equal(await prisma.transaction.count(), 0);
    assert.equal(await prisma.creditCardInvoice.count(), 0);
  });
});
