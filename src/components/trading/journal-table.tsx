import { Money } from "@/components/money";
import { formatDateShort } from "@/lib/format";
import type { TradeRow } from "@/lib/queries/trading";
import { cn } from "@/lib/utils";

const price = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const rMultiple = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: "exceptZero",
});

export function formatR(value: number): string {
  return `${rMultiple.format(value)} R`;
}

/** Operações do diário. Em telas estreitas a tabela rola na horizontal dentro do próprio quadro. */
export function JournalTable({ rows }: { rows: TradeRow[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-outline-variant bg-card">
      <table className="w-full min-w-[640px] text-sm">
        <caption className="sr-only">Operações do diário no período</caption>
        <thead>
          <tr className="border-b border-outline-variant text-left text-xs text-on-surface-variant">
            <th scope="col" className="px-4 py-2.5 font-medium">Saída</th>
            <th scope="col" className="px-4 py-2.5 font-medium">Ativo</th>
            <th scope="col" className="px-4 py-2.5 font-medium">Setup</th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">Qtd.</th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">Entrada → saída</th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">Resultado</th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">R</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-outline-variant last:border-0">
              <td className="px-4 py-2.5 whitespace-nowrap text-on-surface-variant">{formatDateShort(r.date)}</td>
              <td className="px-4 py-2.5">
                <span className="font-medium text-on-surface">{r.ticker}</span>
                {r.style && <span className="ml-2 text-xs text-on-surface-variant">{r.style}</span>}
              </td>
              <td className="max-w-48 truncate px-4 py-2.5 text-on-surface-variant" title={r.setup ?? undefined}>
                {r.setup ?? <span className="sr-only">sem setup</span>}
              </td>
              <td className="px-4 py-2.5 text-right">{r.quantity || ""}</td>
              <td className="px-4 py-2.5 text-right whitespace-nowrap text-on-surface-variant">
                {r.entryPrice !== null ? price.format(r.entryPrice) : ""}
                {r.exitPrice !== null && ` → ${price.format(r.exitPrice)}`}
              </td>
              <td className="px-4 py-2.5 text-right whitespace-nowrap">
                {r.resultBrl !== null ? (
                  <Money value={r.resultBrl} className="font-medium" />
                ) : (
                  <span className="text-on-surface-variant">aberta</span>
                )}
              </td>
              <td
                className={cn(
                  "px-4 py-2.5 text-right whitespace-nowrap",
                  r.resultR === null ? "text-on-surface-variant" : r.resultR < 0 ? "text-expense" : "text-on-surface",
                )}
              >
                {r.resultR !== null ? formatR(r.resultR) : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
