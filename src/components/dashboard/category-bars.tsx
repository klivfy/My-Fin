import { formatBRL, formatPercent } from "@/lib/format";
import type { DashboardData } from "@/lib/queries/dashboard";

const VISIBLE = 8;

/**
 * Gastos por categoria em barras horizontais de uma cor só: comparar
 * comprimentos é mais preciso que comparar fatias, e o rótulo e o valor
 * ficam lado a lado (a cor não carrega informação).
 */
export function CategoryBars({ data }: { data: DashboardData["categoryBreakdown"] }) {
  const total = data.reduce((sum, item) => sum + item.total, 0);
  const max = data[0]?.total ?? 0;
  const shown = data.slice(0, VISIBLE);
  const rest = data.slice(VISIBLE);
  const restTotal = rest.reduce((sum, item) => sum + item.total, 0);

  return (
    <section aria-labelledby="gastos-categoria" className="rounded-xl border border-outline-variant bg-card p-5">
      <h2 id="gastos-categoria" className="text-sm font-medium text-on-surface">
        Despesas por categoria (R$)
      </h2>
      {data.length === 0 ? (
        <p className="py-10 text-center text-sm text-on-surface-variant">Nenhuma despesa categorizada no período.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {shown.map((item) => (
            <li key={item.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1.5">
              <span className="truncate text-sm text-on-surface" title={item.name}>
                {item.name}
              </span>
              <span className="text-sm tabular-nums">
                <span className="money-value font-medium text-on-surface">{formatBRL(item.total)}</span>
                <span className="ml-2 inline-block w-10 text-right text-on-surface-variant">
                  {formatPercent(total > 0 ? item.total / total : 0, 0)}
                </span>
              </span>
              <div className="col-span-2 h-1.5 overflow-hidden rounded-full bg-surface-container-high" aria-hidden>
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${max > 0 ? (item.total / max) * 100 : 0}%` }}
                />
              </div>
            </li>
          ))}
          {rest.length > 0 && (
            <li className="flex justify-between gap-4 border-t border-outline-variant pt-3 text-sm text-on-surface-variant">
              <span>
                Outras {rest.length} {rest.length === 1 ? "categoria" : "categorias"}
              </span>
              <span className="money-value tabular-nums">{formatBRL(restTotal)}</span>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
