import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Money } from "@/components/money";
import { formatBRL, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BudgetView } from "@/lib/queries/budgets";

export function BudgetCard({ budget }: { budget: BudgetView }) {
  const overBudget = budget.progressPct >= 1;
  const barPct = Math.min(1, budget.progressPct) * 100;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <div className="flex items-center gap-2">
          <span className="size-2.5 rounded-full" style={{ backgroundColor: budget.color }} />
          <CardTitle className="text-sm font-medium">{budget.name}</CardTitle>
        </div>
        {(budget.isAcceleratedBurn || overBudget) && (
          <span
            className={cn(
              "flex items-center gap-1 text-xs font-medium",
              overBudget ? "text-expense" : "text-transfer",
            )}
          >
            <AlertTriangle className="size-3" />
            {overBudget ? "Estourou" : "Ritmo acelerado"}
          </span>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-baseline justify-between">
          <Money value={-budget.spent} tone="expense" showSign={false} className="text-lg" />
          <span className="text-xs text-on-surface-variant">de {formatBRL(budget.budgetLimit)}</span>
        </div>

        <div className="relative h-2 w-full overflow-hidden rounded-full bg-surface-container-highest">
          <div
            className={cn("h-full rounded-full transition-all", overBudget ? "bg-expense" : "bg-primary")}
            style={{ width: `${barPct}%` }}
          />
          {/* Marcador do ritmo esperado para o dia atual do mês. */}
          <div
            className="absolute top-0 h-full w-px bg-on-surface/40"
            style={{ left: `${Math.min(100, budget.expectedPct * 100)}%` }}
            title="Ritmo esperado para hoje"
          />
        </div>

        <p className="text-xs text-on-surface-variant">
          {formatPercent(budget.progressPct, 0)} do orçamento usado
          <span className="mx-1.5" aria-hidden>
            ·
          </span>
          {budget.spent > budget.budgetLimit ? (
            <span className="font-medium text-expense">
              passou {formatBRL(budget.spent - budget.budgetLimit)} do teto
            </span>
          ) : (
            <>
              cabem <span className="font-medium text-on-surface tabular-nums">{formatBRL(budget.perDayLeft)}/dia</span>{" "}
              {budget.daysLeft === 1 ? "hoje" : `nos ${budget.daysLeft} dias que faltam`}
              {budget.pendingBills > 0 && (
                <>
                  , depois de reservar{" "}
                  <span className="tabular-nums">{formatBRL(budget.pendingBills)}</span> em contas a vencer
                </>
              )}
            </>
          )}
        </p>
      </CardContent>
    </Card>
  );
}
