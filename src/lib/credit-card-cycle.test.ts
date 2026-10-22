import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import Decimal from "decimal.js";
import { invoiceWindowForPurchase, planInstallments, splitInstallments } from "@/lib/credit-card-cycle";

const day = (d: Date) => d.toISOString().slice(0, 10);

describe("ciclo de fatura", () => {
  it("compra até o dia 25 cai na fatura do mês; depois, na do mês seguinte", () => {
    assert.equal(day(invoiceWindowForPurchase(new Date(Date.UTC(2025, 0, 25)), 0).closingDate), "2025-01-25");
    assert.equal(day(invoiceWindowForPurchase(new Date(Date.UTC(2025, 0, 26)), 0).closingDate), "2025-02-25");
    assert.equal(day(invoiceWindowForPurchase(new Date(Date.UTC(2025, 11, 26)), 0).dueDate), "2026-02-05");
  });

  it("resto do arredondamento fica na última parcela", () => {
    const parts = splitInstallments(new Decimal("100.00"), 3).map((p) => p.toFixed(2));
    assert.deepEqual(parts, ["33.33", "33.33", "33.34"]);
  });

  it("uma parcela por fatura, pulando faturas pagas", () => {
    const plan = planInstallments({
      date: new Date(Date.UTC(2025, 0, 10)),
      amounts: splitInstallments(new Decimal("90"), 3),
      paidClosingDates: new Set([new Date(Date.UTC(2025, 0, 25)).toISOString(), new Date(Date.UTC(2025, 2, 25)).toISOString()]),
    });
    assert.deepEqual(
      plan.map((p) => [p.installmentNumber, day(p.closingDate)]),
      [
        [1, "2025-02-25"],
        [2, "2025-04-25"],
        [3, "2025-05-25"],
      ],
    );
  });
});
