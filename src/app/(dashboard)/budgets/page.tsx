import { PiggyBank, Target } from "lucide-react";
import { getBudgetViews } from "@/lib/queries/budgets";
import { getSavingsGoalViews } from "@/lib/queries/savings-goals";
import { prisma } from "@/lib/prisma";
import { BudgetCard } from "@/components/budgets/budget-card";
import { NewBudgetCategoryDialog } from "@/components/budgets/budget-dialogs";
import { DeleteSavingsGoalButton, NewSavingsGoalDialog } from "@/components/budgets/savings-goal-dialogs";
import { CategoryRulesPanel, type RuleView } from "@/components/budgets/category-rules-panel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Money } from "@/components/money";
import { formatBRL, formatDateShort, formatPercent } from "@/lib/format";
import { EmptyState } from "@/components/dashboard/empty-state";

export default async function BudgetsPage() {
  const [budgets, goals, savingsAccounts, expenseCategories, ruleRows] = await Promise.all([
    getBudgetViews(),
    getSavingsGoalViews(),
    prisma.account.findMany({
      where: { isActive: true, type: { not: "CREDIT_CARD" } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.category.findMany({
      where: { type: "EXPENSE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.categoryRule.findMany({
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      include: { category: { select: { name: true } } },
    }),
  ]);

  const rules: RuleView[] = ruleRows.map((rule) => ({
    id: rule.id,
    pattern: rule.pattern,
    categoryId: rule.categoryId,
    categoryName: rule.category.name,
    priority: rule.priority,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-on-surface">Orçamentos Mensais</h1>
          <p className="text-sm text-on-surface-variant">Gasto real vs. teto planejado no mês corrente.</p>
        </div>
        <NewBudgetCategoryDialog />
      </div>

      {budgets.length === 0 ? (
        <EmptyState
          icon={PiggyBank}
          title="Nenhum orçamento definido"
          description="Crie uma categoria de despesa com teto mensal para acompanhar o ritmo de gasto aqui."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {budgets.map((budget) => (
            <BudgetCard key={budget.id} budget={budget} />
          ))}
        </div>
      )}

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold text-on-surface">
            <Target className="size-4" /> Metas de poupança
          </h2>
          <NewSavingsGoalDialog accounts={savingsAccounts} />
        </div>

        {goals.length === 0 ? (
          <p className="text-sm text-on-surface-variant">
            Nenhuma meta definida. Crie uma para acompanhar o progresso do saldo em direção ao objetivo.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {goals.map((goal) => (
              <Card key={goal.id}>
                <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">{goal.name}</CardTitle>
                  <DeleteSavingsGoalButton id={goal.id} />
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-baseline justify-between">
                    <Money value={goal.currentAmount} tone="income" showSign={false} className="text-lg" />
                    <span className="text-xs text-on-surface-variant">de {formatBRL(goal.targetAmount)}</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-surface-container-highest">
                    <div
                      className="h-full rounded-full bg-income transition-all"
                      style={{ width: `${Math.min(1, goal.progressPct) * 100}%` }}
                    />
                  </div>
                  <p className="text-xs text-on-surface-variant">
                    {formatPercent(goal.progressPct, 0)} · {goal.accountName} · até{" "}
                    {formatDateShort(goal.targetDate)}
                    {goal.monthlyNeeded !== null && goal.progressPct < 1 && (
                      <> · faltam {formatBRL(goal.monthlyNeeded)}/mês</>
                    )}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <CategoryRulesPanel rules={rules} categories={expenseCategories} />
    </div>
  );
}
