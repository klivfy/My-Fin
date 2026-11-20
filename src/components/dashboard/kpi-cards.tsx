import { Money } from "@/components/money";
import { formatPercent } from "@/lib/format";
import type { DashboardData } from "@/lib/queries/dashboard";

/**
 * Resumo do período numa faixa só: mesmo formato do resumo do diário de
 * trading, para as duas seções lerem igual. Rótulo, valor e contexto real.
 */
export function KpiCards({ data }: { data: DashboardData }) {
  return (
    <section aria-labelledby="resumo-financas" className="rounded-xl border border-outline-variant bg-surface-container-lowest p-5">
      <h2 id="resumo-financas" className="sr-only">
        Resumo do período
      </h2>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4">
        <div className="col-span-2 lg:col-span-1">
          <dt className="text-sm text-on-surface-variant">Patrimônio líquido</dt>
          <dd className="mt-1 text-2xl">
            <Money value={data.netWorth} tone="neutral" showSign={false} />
          </dd>
          <dd className="mt-0.5 text-xs text-on-surface-variant">soma das contas ativas hoje</dd>
        </div>
        <div>
          <dt className="text-sm text-on-surface-variant">Entradas</dt>
          <dd className="mt-1 text-lg">
            <Money value={data.income} tone="income" />
          </dd>
        </div>
        <div>
          <dt className="text-sm text-on-surface-variant">Saídas</dt>
          <dd className="mt-1 text-lg">
            <Money value={data.expense} tone="expense" showSign={false} />
          </dd>
        </div>
        <div className="col-span-2 grid grid-cols-2 gap-x-6 lg:col-span-1 lg:grid-cols-1 lg:gap-y-1">
          <div>
            <dt className="text-sm text-on-surface-variant">Taxa de poupança</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums text-on-surface">
              {data.savingsRatePct === null ? "sem entradas" : formatPercent(data.savingsRatePct)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-on-surface-variant">Gasto médio por dia</dt>
            <dd className="mt-1 text-sm">
              <Money value={data.dailyBurnRate} tone="neutral" showSign={false} className="font-medium" />
            </dd>
          </div>
        </div>
      </dl>
    </section>
  );
}
