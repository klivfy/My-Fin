import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, it } from "node:test";
import { createAccount, loadPrisma, resetDatabase, skipWithoutDb } from "@/test/db";
import type { PeriodRange } from "@/lib/period";

const january2025: PeriodRange = {
  key: "current-month",
  label: "Janeiro",
  from: new Date(Date.UTC(2025, 0, 1)),
  to: new Date(Date.UTC(2025, 0, 31, 23, 59, 59, 999)),
};

async function addTransaction(data: {
  accountId: string;
  amount: string;
  type: "INCOME" | "EXPENSE" | "TRANSFER" | "ADJUSTMENT";
  date: Date;
  categoryId?: string;
}) {
  const prisma = await loadPrisma();
  await prisma.transaction.create({
    data: { ...data, description: data.type, reconciliationHash: randomUUID() },
  });
}

describe("dados do dashboard (banco real)", { skip: skipWithoutDb }, () => {
  beforeEach(resetDatabase);

  it("sem lançamentos", async () => {
    const { getDashboardData } = await import("@/lib/queries/dashboard");
    await createAccount({ type: "CHECKING", balance: "100.00" });
    const data = await getDashboardData(january2025);
    assert.equal(data.hasAnyTransaction, false);
    assert.equal(data.dailyBalanceSeries.length, 31);
    assert.ok(data.dailyBalanceSeries.every((p) => p.projected === 100 && p.realized === 100));
  });

  it("série diária, entradas/saídas e categorias do período", async () => {
    const prisma = await loadPrisma();
    const { getDashboardData } = await import("@/lib/queries/dashboard");
    const checking = await createAccount({ type: "CHECKING", balance: "1000.00" });
    const savings = await createAccount({ type: "SAVINGS", balance: "200.00" });
    const inactive = await createAccount({ type: "CHECKING", balance: "500.00", isActive: false });
    const food = await prisma.category.create({ data: { name: "Mercado", type: "EXPENSE", color: "#f00" } });
    const salary = await prisma.category.create({ data: { name: "Salário", type: "INCOME", color: "#0f0" } });

    const day = (m: number, d: number, h = 12) => new Date(Date.UTC(2025, m, d, h));
    await addTransaction({ accountId: checking.id, amount: "-100.00", type: "EXPENSE", date: new Date(Date.UTC(2024, 11, 15)) });
    await addTransaction({ accountId: checking.id, amount: "3000.00", type: "INCOME", date: day(0, 3, 9), categoryId: salary.id });
    await addTransaction({ accountId: checking.id, amount: "-50.00", type: "EXPENSE", date: day(0, 3, 23), categoryId: food.id });
    await addTransaction({ accountId: checking.id, amount: "-30.00", type: "EXPENSE", date: day(0, 20), categoryId: food.id });
    await addTransaction({ accountId: checking.id, amount: "-200.00", type: "EXPENSE", date: day(0, 10) });
    await addTransaction({ accountId: checking.id, amount: "-300.00", type: "TRANSFER", date: day(0, 10) });
    await addTransaction({ accountId: savings.id, amount: "300.00", type: "TRANSFER", date: day(0, 10) });
    await addTransaction({ accountId: checking.id, amount: "-5.00", type: "ADJUSTMENT", date: day(0, 31, 23) });
    await addTransaction({ accountId: checking.id, amount: "-999.00", type: "EXPENSE", date: day(1, 5) });
    await addTransaction({ accountId: inactive.id, amount: "-40.00", type: "EXPENSE", date: day(0, 5) });
    await prisma.account.update({ where: { id: checking.id }, data: { currentBalance: "1316.00" } });
    await prisma.account.update({ where: { id: savings.id }, data: { currentBalance: "500.00" } });

    const data = await getDashboardData(january2025);

    assert.equal(data.hasAnyTransaction, true);
    assert.equal(data.netWorth, 1816);
    assert.equal(data.income, 3000);
    assert.equal(data.expense, -280);
    assert.equal(data.savingsRatePct, (3000 - 280) / 3000);
    assert.equal(data.dailyBurnRate, 9.03);
    assert.deepEqual(data.categoryBreakdown, [
      { id: "uncategorized", name: "Sem categoria", color: "var(--muted-foreground)", total: 200 },
      { id: food.id, name: "Mercado", color: "#f00", total: 80 },
    ]);

    const byDay = new Map(data.dailyBalanceSeries.map((p) => [p.date, p.projected]));
    assert.equal(data.dailyBalanceSeries.length, 31);
    assert.equal(byDay.get("2025-01-01"), 1100);
    assert.equal(byDay.get("2025-01-02"), 1100);
    assert.equal(byDay.get("2025-01-03"), 4050);
    assert.equal(byDay.get("2025-01-10"), 3850);
    assert.equal(byDay.get("2025-01-20"), 3820);
    assert.equal(byDay.get("2025-01-31"), 3815);
    assert.deepEqual(data.netWorthSparkline, data.dailyBalanceSeries.map((p) => p.projected));
    assert.ok(data.dailyBalanceSeries.every((p) => p.realized === p.projected));
  });
});
