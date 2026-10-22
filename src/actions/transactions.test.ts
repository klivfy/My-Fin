import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, it } from "node:test";
import { ZodError } from "zod";
import { createAccount, ledgerDrift, loadPrisma, resetDatabase, skipWithoutDb } from "@/test/db";

async function loadActions() {
  return import("@/actions/transactions");
}

describe("transações e saldo (banco real)", { skip: skipWithoutDb }, () => {
  beforeEach(resetDatabase);

  it("edições simultâneas da mesma transação não perdem atualização de saldo", async () => {
    const prisma = await loadPrisma();
    const { createTransaction, updateTransaction } = await loadActions();
    const account = await createAccount({ type: "CHECKING", balance: "1000.00" });
    const tx = await createTransaction({
      accountId: account.id,
      amount: "100.00",
      type: "EXPENSE",
      description: "Mercado",
      date: new Date(Date.UTC(2025, 0, 10)),
    });

    await Promise.all(
      [110, 120, 130, 140, 150, 160, 170, 180].map((amount) =>
        updateTransaction({ id: tx.id, amount: String(amount) }),
      ),
    );

    assert.equal(await ledgerDrift(account.id), "0.00");
    const final = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
    const balance = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    assert.equal(balance.currentBalance.toFixed(2), (1000 + Number(final.amount)).toFixed(2));
  });

  it("edição e exclusão simultâneas mantêm o saldo consistente", async () => {
    const { createTransaction, deleteTransaction, updateTransaction } = await loadActions();
    const account = await createAccount({ type: "CHECKING", balance: "1000.00" });
    const tx = await createTransaction({
      accountId: account.id,
      amount: "100.00",
      type: "EXPENSE",
      description: "Farmácia",
      date: new Date(Date.UTC(2025, 0, 10)),
    });

    await Promise.allSettled([
      updateTransaction({ id: tx.id, amount: "250.00" }),
      deleteTransaction({ id: tx.id }),
      updateTransaction({ id: tx.id, amount: "300.00" }),
    ]);

    assert.equal(await ledgerDrift(account.id), "0.00");
  });

  it("exclusão em lote é tudo ou nada", async () => {
    const prisma = await loadPrisma();
    const { createTransaction, deleteTransactions } = await loadActions();
    const { createInstallmentPurchase } = await import("@/actions/credit-cards");
    const checking = await createAccount({ type: "CHECKING", balance: "1000.00" });
    const card = await createAccount({ type: "CREDIT_CARD" });
    const manual = await createTransaction({
      accountId: checking.id,
      amount: "40.00",
      type: "EXPENSE",
      description: "Padaria",
      date: new Date(Date.UTC(2025, 0, 10)),
    });
    const [installment] = await createInstallmentPurchase({
      accountId: card.id,
      totalAmount: "100.00",
      description: "Fone",
      date: new Date(Date.UTC(2025, 0, 10)),
      totalInstallments: 1,
    });

    await assert.rejects(deleteTransactions({ ids: [manual.id, installment.id] }), /fatura de cartão/);

    assert.equal(await prisma.transaction.count({ where: { id: manual.id } }), 1);
    const balance = await prisma.account.findUniqueOrThrow({ where: { id: checking.id } });
    assert.equal(balance.currentBalance.toFixed(2), "960.00");
  });

  it("exclusão em lote reverte o saldo de cada conta", async () => {
    const prisma = await loadPrisma();
    const { createTransaction, deleteTransactions } = await loadActions();
    const a = await createAccount({ type: "CHECKING", balance: "1000.00" });
    const b = await createAccount({ type: "SAVINGS", balance: "500.00" });
    const date = new Date(Date.UTC(2025, 0, 10));
    const created = await Promise.all([
      createTransaction({ accountId: a.id, amount: "10.00", type: "EXPENSE", description: "x1", date }),
      createTransaction({ accountId: a.id, amount: "20.00", type: "INCOME", description: "x2", date }),
      createTransaction({ accountId: b.id, amount: "30.00", type: "EXPENSE", description: "x3", date }),
      createTransaction({ accountId: b.id, amount: "5.00", type: "EXPENSE", description: "x4", date }),
    ]);
    const keep = await createTransaction({ accountId: a.id, amount: "1.00", type: "EXPENSE", description: "fica", date });

    await deleteTransactions({ ids: created.map((t) => t.id) });

    const [accA, accB] = await Promise.all([
      prisma.account.findUniqueOrThrow({ where: { id: a.id } }),
      prisma.account.findUniqueOrThrow({ where: { id: b.id } }),
    ]);
    assert.equal(accA.currentBalance.toFixed(2), "999.00");
    assert.equal(accB.currentBalance.toFixed(2), "500.00");
    assert.equal(await prisma.transaction.count(), 1);
    assert.equal((await prisma.transaction.findFirstOrThrow()).id, keep.id);
    assert.equal(await ledgerDrift(a.id), "0.00");
    assert.equal(await ledgerDrift(b.id), "0.00");
  });

  it("exclusão em lote recusa id inexistente sem apagar nada", async () => {
    const prisma = await loadPrisma();
    const { createTransaction, deleteTransactions } = await loadActions();
    const account = await createAccount({ type: "CHECKING", balance: "100.00" });
    const tx = await createTransaction({
      accountId: account.id,
      amount: "10.00",
      type: "EXPENSE",
      description: "Banca",
      date: new Date(Date.UTC(2025, 0, 10)),
    });

    await assert.rejects(deleteTransactions({ ids: [tx.id, randomUUID()] }));
    assert.equal(await prisma.transaction.count(), 1);
  });

  it("exclusão em lote limita a quantidade de ids", async () => {
    const { deleteTransactions } = await loadActions();
    const ids = Array.from({ length: 501 }, () => randomUUID());
    await assert.rejects(deleteTransactions({ ids }), ZodError);
  });
});
