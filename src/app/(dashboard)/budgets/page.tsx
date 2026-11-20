import { PiggyBank } from "lucide-react";
import { resolvePeriodRange } from "@/lib/period";
import { getBudgetViews } from "@/lib/queries/budgets";
import { getBudgetRuleView } from "@/lib/queries/budget-rule";
import { getGoalsData } from "@/lib/queries/goals";
import { getPotsView, resolveEntrada } from "@/lib/queries/pots";
import { BudgetCard } from "@/components/budgets/budget-card";
import { BudgetRuleCard } from "@/components/budgets/budget-rule-card";
import { PotsCard } from "@/components/budgets/pots-card";
import { GoalsSection } from "@/components/goals/goals-section";
import { EmptyState } from "@/components/dashboard/empty-state";

export default async function BudgetsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; entrada?: string }>;
}) {
  const { period, entrada } = await searchParams;
  const range = resolvePeriodRange(period);
  const [ruleView, potsView, goals, budgets] = await Promise.all([
    getBudgetRuleView(range),
    getPotsView(range, resolveEntrada(entrada)),
    getGoalsData(),
    getBudgetViews(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-on-surface">Orçamentos</h1>
        <p className="text-sm text-on-surface-variant">
          Regra 50/30/20 e 6 potes no período selecionado, metas de poupança e tetos por categoria no mês corrente.
        </p>
      </div>

      <BudgetRuleCard view={ruleView} />

      <PotsCard view={potsView} entradaParam={entrada ?? ""} />

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
