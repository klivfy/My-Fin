import { Wallet } from "lucide-react";
import { resolvePeriodRange } from "@/lib/period";
import { getDashboardData } from "@/lib/queries/dashboard";
import { getTradingHomeSummary } from "@/lib/queries/trading";
import { getDebtHomeSummary } from "@/lib/queries/debts";
import { KpiCards } from "@/components/dashboard/kpi-cards";
import { CashFlowChart } from "@/components/dashboard/cash-flow-chart";
import { CategoryBars } from "@/components/dashboard/category-bars";
import { EmptyState } from "@/components/dashboard/empty-state";
import { TradingHomeSummaryCard } from "@/components/trading/trading-home-summary";
import { DebtHomeSummaryCard } from "@/components/debts/debt-home-summary";

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { period } = await searchParams;
  const range = resolvePeriodRange(period);
  const [data, trading, debts] = await Promise.all([
    getDashboardData(range),
    getTradingHomeSummary(),
    getDebtHomeSummary(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-on-surface">Visão geral</h1>
        <p className="text-sm text-on-surface-variant">{range.label}</p>
      </div>

      {data.hasAnyTransaction ? (
        <>
          <KpiCards data={data} />
          <CashFlowChart data={data.dailyBalanceSeries} />
          <CategoryBars data={data.categoryBreakdown} />
        </>
      ) : (
        <EmptyState
          icon={Wallet}
          title="Nenhuma transação ainda"
          description="Importe um extrato .ofx na tela de Extrato ou adicione uma transação manual pelo botão “Nova transação”."
        />
      )}

      {debts && <DebtHomeSummaryCard summary={debts} />}

      {trading && <TradingHomeSummaryCard summary={trading} />}
    </div>
  );
}
