import { BarChart3 } from "lucide-react";
import { getReportsData } from "@/lib/queries/reports";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Money } from "@/components/money";
import { formatBRL, formatDateShort, formatPercent } from "@/lib/format";
import { EmptyState } from "@/components/dashboard/empty-state";

export default async function ReportsPage() {
  const data = await getReportsData(6);
  const hasData = data.months.some((m) => m.income !== 0 || m.expense !== 0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-on-surface">Relatórios</h1>
        <p className="text-sm text-on-surface-variant">
          Últimos 6 meses: comparativo mensal, médias por categoria e maiores despesas.
        </p>
      </div>

      {!hasData ? (
        <EmptyState
          icon={BarChart3}
          title="Sem dados suficientes"
          description="Importe um extrato ou lance transações para ver os relatórios."
        />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Receita vs. despesa por mês</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {data.months.map((month) => {
                  const max = Math.max(month.income, month.expense, 1);
                  return (
                    <div key={month.month} className="space-y-1">
                      <div className="flex items-center justify-between text-xs text-on-surface-variant">
                        <span className="font-medium text-on-surface">{month.month}</span>
                        <span>
                          {formatBRL(month.income)} / {formatBRL(month.expense)}
                          {month.savingsRatePct !== null && (
                            <> · poupança {formatPercent(month.savingsRatePct, 0)}</>
                          )}
                        </span>
                      </div>
                      <div className="space-y-0.5">
                        <div
                          className="h-2 rounded-full bg-income"
                          style={{ width: `${(month.income / max) * 100}%` }}
                        />
                        <div
                          className="h-2 rounded-full bg-expense"
                          style={{ width: `${(month.expense / max) * 100}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              {data.avgSavingsRatePct !== null && (
                <p className="mt-4 text-xs text-on-surface-variant">
                  Taxa média de poupança no período:{" "}
                  <span className="font-medium text-on-surface">
                    {formatPercent(data.avgSavingsRatePct, 1)}
                  </span>
                </p>
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Média mensal por categoria</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {data.categoryAverages.map((category) => (
                    <li key={category.id} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 text-on-surface">
                        <span className="size-2 rounded-full" style={{ backgroundColor: category.color }} />
                        {category.name}
                      </span>
                      <Money value={-category.monthlyAverage} tone="expense" showSign={false} className="text-xs" />
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Maiores despesas do período</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {data.topExpenses.map((expense) => (
                    <li key={expense.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate text-on-surface">
                        <span className="mr-2 text-xs text-on-surface-variant">
                          {formatDateShort(expense.date)}
                        </span>
                        {expense.description}
                        {expense.category && (
                          <span className="ml-2 text-xs text-on-surface-variant">{expense.category}</span>
                        )}
                      </span>
                      <Money value={-expense.amount} tone="expense" showSign={false} className="shrink-0 text-xs" />
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
