import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { formatBRL } from "@/lib/format";
import type { DebtHomeSummary } from "@/lib/queries/debts";

const monthYear = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso));

/** Dívidas na Visão geral: quanto falta e quando fica livre, com e sem rolar as parcelas. */
export function DebtHomeSummaryCard({ summary }: { summary: DebtHomeSummary }) {
  return (
    <section
      aria-labelledby="dividas-resumo"
      className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-outline-variant bg-surface-container-lowest p-5"
    >
      <div className="space-y-1">
        <h2 id="dividas-resumo" className="text-sm font-medium text-on-surface">
          Dívidas · {summary.count} em aberto
        </h2>
        <p className="text-sm text-on-surface-variant tabular-nums">
          ~{formatBRL(summary.balanceToday)} para quitar hoje
          <span className="mx-2" aria-hidden>
            ·
          </span>
          {formatBRL(summary.monthlyInstallments)}/mês em parcelas
          <span className="mx-2" aria-hidden>
            ·
          </span>
          {summary.monthsSaved > 0 ? (
            <>
              livre em <span className="font-medium text-on-surface">{monthYear(summary.rolledFreeOn)}</span> rolando as
              parcelas (no contrato, {monthYear(summary.contractFreeOn)})
            </>
          ) : (
            <>livre em {monthYear(summary.contractFreeOn)}</>
          )}
        </p>
      </div>
      <Link
        href="/dividas"
        className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-primary hover:bg-secondary"
      >
        Ver plano
        <ArrowRight className="size-4" aria-hidden />
      </Link>
    </section>
  );
}
