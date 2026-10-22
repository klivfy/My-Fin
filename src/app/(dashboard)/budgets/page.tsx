import { PiggyBank } from "lucide-react";
import { resolvePeriodRange } from "@/lib/period";
import { getBudgetViews } from "@/lib/queries/budgets";
import { getBudgetRuleView } from "@/lib/queries/budget-rule";
import { getGoalsData } from "@/lib/queries/goals";
import { BudgetCard } from "@/components/budgets/budget-card";
import { BudgetRuleCard } from "@/components/budgets/budget-rule-card";
import { GoalsSection } from "@/components/goals/goals-section";
import { EmptyState } from "@/components/dashboard/empty-state";

export default async function BudgetsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { period } = await searchParams;
  const [ruleView, goals, budgets] = await Promise.all([
    getBudgetRuleView(resolvePeriodRange(period)),
    getGoalsData(),
    getBudgetViews(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-on-surface">Orçamentos</h1>
        <p className="text-sm text-on-surface-variant">
          Necessidades, Desejos e Poupança no período selecionado, metas de poupança e tetos por categoria no mês
          corrente.
        </p>
      </div>

      <BudgetRuleCard view={ruleView} />

      <GoalsSection data={goals} />

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-on-surface">Tetos por categoria · mês corrente</h2>
        {budgets.length === 0 ? (
          <EmptyState
            icon={PiggyBank}
            title="Nenhum orçamento definido"
            description="Defina um teto (budgetLimit) em uma categoria de despesa para acompanhar o ritmo de gasto aqui."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {budgets.map((budget) => (
              <BudgetCard key={budget.id} budget={budget} />
            ))}
          </div>
        )}
      </section>

      <p className="text-xs text-on-surface-variant">
        Ferramenta educativa — não substitui aconselhamento financeiro.
      </p>
    </div>
  );
}
