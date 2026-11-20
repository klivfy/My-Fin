import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Money } from "@/components/money";
import type { TradingHomeSummary } from "@/lib/queries/trading";

/** A ponte entre as duas seções na Visão geral: trading no mês, modo real. */
export function TradingHomeSummaryCard({ summary }: { summary: TradingHomeSummary }) {
  const status = !summary.limitsSet
    ? "limites de risco não configurados"
    : summary.entriesBlocked
      ? "novas entradas bloqueadas hoje"
      : "dentro dos limites hoje";

  return (
    <section
      aria-labelledby="trading-mes"
      className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-outline-variant bg-surface-container-lowest p-5"
    >
      <div className="space-y-1">
        <h2 id="trading-mes" className="text-sm font-medium text-on-surface">
          Trading no mês · modo real
        </h2>
        <p className="text-sm text-on-surface-variant">
          <Money value={summary.monthNet} className="text-base" />
          <span className="mx-2" aria-hidden>
            ·
          </span>
          {summary.monthClosed} {summary.monthClosed === 1 ? "operação fechada" : "operações fechadas"}
          <span className="mx-2" aria-hidden>
            ·
          </span>
          <span className={summary.entriesBlocked ? "font-medium text-expense" : undefined}>{status}</span>
        </p>
      </div>
      <Link
        href="/trading"
        className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-primary hover:bg-secondary"
      >
        Abrir diário
        <ArrowRight className="size-4" aria-hidden />
      </Link>
    </section>
  );
}
