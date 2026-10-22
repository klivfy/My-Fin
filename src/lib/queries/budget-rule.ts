import Decimal from "decimal.js";
import { prisma } from "@/lib/prisma";
import type { PeriodRange } from "@/lib/period";
import { computeBudgetRule, type Bucket, type CategorySpend } from "@/lib/financial-engine/budget-rule";

export interface BucketView {
  target: number;
  actual: number;
  actualShare: number | null;
}

export interface CategoryLine {
  id: string;
  name: string;
  color: string;
  spent: number;
}

export interface BudgetRuleView {
  periodLabel: string;
  income: number;
  split: { need: number; want: number; savings: number };
  splitReason: string;
  needs: BucketView;
  wants: BucketView;
  savings: BucketView;
  /** Categorias de cada natureza com gasto no período, maior gasto primeiro. */
  needCategories: CategoryLine[];
  wantCategories: CategoryLine[];
  savingsCategories: CategoryLine[];
  unclassified: { total: number; categories: CategoryLine[] };
  cuts: {
    gap: number;
    uncovered: number;
    suggestions: Array<{ id: string; name: string; spent: number; cut: number }>;
  };
}

const UNCATEGORIZED_ID = "uncategorized";

function toView(bucket: Bucket): BucketView {
  return { target: bucket.target.toNumber(), actual: bucket.actual.toNumber(), actualShare: bucket.actualShare };
}

/**
 * Regra 50/30/20 do período: mesmo recorte do Dashboard (contas ativas,
 * só INCOME/EXPENSE — transferências e ajustes não contam).
 */
export async function getBudgetRuleView(range: PeriodRange): Promise<BudgetRuleView> {
  const transactions = await prisma.transaction.findMany({
    where: {
      account: { isActive: true },
      date: { gte: range.from, lte: range.to },
      type: { in: ["INCOME", "EXPENSE"] },
    },
    select: {
      amount: true,
      type: true,
      categoryId: true,
      category: { select: { name: true, color: true, nature: true } },
    },
  });

  let income = new Decimal(0);
  const spendMap = new Map<string, CategorySpend & { color: string }>();

  for (const t of transactions) {
    const amount = new Decimal(t.amount.toString());
    if (t.type === "INCOME") {
      income = income.plus(amount);
      continue;
    }
    const key = t.categoryId ?? UNCATEGORIZED_ID;
    const existing = spendMap.get(key);
    if (existing) {
      existing.spent = existing.spent.plus(amount.abs());
    } else {
      spendMap.set(key, {
        categoryId: t.categoryId,
        name: t.category?.name ?? "Sem categoria",
        nature: t.category?.nature ?? null,
        color: t.category?.color ?? "var(--color-outline)",
        spent: amount.abs(),
      });
    }
  }

  const expenses = [...spendMap.values()];
  const result = computeBudgetRule(income, expenses);

  const lines = (filter: (e: CategorySpend) => boolean): CategoryLine[] =>
    expenses
      .filter((e) => filter(e) && e.spent.gt(0))
      .sort((a, b) => b.spent.comparedTo(a.spent))
      .map((e) => ({
        id: e.categoryId ?? UNCATEGORIZED_ID,
        name: e.name,
        color: spendMap.get(e.categoryId ?? UNCATEGORIZED_ID)!.color,
        spent: e.spent.toNumber(),
      }));

  return {
    periodLabel: range.label,
    income: income.toNumber(),
    split: result.split,
    splitReason: result.splitReason,
    needs: toView(result.needs),
    wants: toView(result.wants),
    savings: toView(result.savings),
    needCategories: lines((e) => e.nature === "NEED"),
    wantCategories: lines((e) => e.nature === "WANT"),
    savingsCategories: lines((e) => e.nature === "SAVINGS"),
    unclassified: { total: result.unclassified.total.toNumber(), categories: lines((e) => e.nature === null) },
    cuts: {
      gap: result.cuts.gap.toNumber(),
      uncovered: result.cuts.uncovered.toNumber(),
      suggestions: result.cuts.suggestions.map((s) => ({
        id: s.categoryId ?? UNCATEGORIZED_ID,
        name: s.name,
        spent: s.spent.toNumber(),
        cut: s.cut.toNumber(),
      })),
    },
  };
}
