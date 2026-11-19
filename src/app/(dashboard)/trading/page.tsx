import Link from "next/link";
import { BookOpenText } from "lucide-react";
import { resolvePeriodRange } from "@/lib/period";
import { formatPercent } from "@/lib/format";
import { getJournal, resolveMode } from "@/lib/queries/trading";
import { Money } from "@/components/money";
import { EmptyState } from "@/components/dashboard/empty-state";
import { DiarioImport } from "@/components/trading/diario-import";
import { ModeSwitch } from "@/components/trading/mode-switch";
import { JournalTable, formatR } from "@/components/trading/journal-table";

export default async function TradingJournalPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; modo?: string }>;
}) {
  const { period, modo } = await searchParams;
  const range = resolvePeriodRange(period);
  const mode = resolveMode(modo);
  const journal = await getJournal(range, mode);
  const modeLabel = mode === "real" ? "real" : "simulado";

  if (!journal.hasAny) {
    return (
      <div className="space-y-6">
        <PageHeader subtitle="Operações registradas pelo b3-diario." />
        <EmptyState
          icon={BookOpenText}
          title="Nenhuma operação importada"
          description="Importe o arquivo trader/diario.csv que o b3-diario grava. O app só lê o diário: nunca envia ordens nem altera o arquivo."
          action={<DiarioImport variant="default" />}
        />
      </div>
    );
  }

  const s = journal.stats;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader subtitle={`${range.label} · modo ${modeLabel}`} />
        <div className="flex flex-wrap items-center gap-2">
          <ModeSwitch current={mode} counts={journal.counts} />
          <DiarioImport />
        </div>
      </div>

      <section aria-labelledby="resumo" className="rounded-xl border border-outline-variant bg-card p-5">
        <h2 id="resumo" className="sr-only">
          Resumo do período
        </h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
          <div className="col-span-2 sm:col-span-1">
            <dt className="text-sm text-on-surface-variant">Resultado líquido</dt>
            <dd className="mt-1 text-2xl">
              <Money value={s.net} />
            </dd>
            <dd className="mt-0.5 text-xs text-on-surface-variant">
              custos de <Money value={s.costs} tone="neutral" showSign={false} className="font-normal" />
            </dd>
          </div>
          <Stat label="Operações fechadas" value={new Intl.NumberFormat("pt-BR").format(s.closed)} />
          <Stat label="Acerto" value={s.winRate === null ? "sem dado" : formatPercent(s.winRate, 0)} />
          <Stat
            label="Expectativa por operação"
            value={s.expectancyR === null ? "sem dado" : formatR(s.expectancyR)}
            negative={s.expectancyR !== null && s.expectancyR < 0}
          />
        </dl>
      </section>

      {journal.rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-outline-variant px-5 py-10 text-center text-sm text-on-surface-variant">
          Nenhuma operação {modeLabel} em {range.label.toLowerCase()}. Troque o período ou o modo acima.
        </p>
      ) : (
        <JournalTable rows={journal.rows} />
      )}

      <p className="text-xs text-on-surface-variant">
        Leitura do diário importado. As regras de risco continuam no b3-risco:{" "}
        <Link href="/trading/risco" className="font-medium text-primary underline-offset-4 hover:underline">
          ver o risco de hoje
        </Link>
        .
      </p>
    </div>
  );
}

function PageHeader({ subtitle }: { subtitle: string }) {
  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-on-surface">Diário de trading</h1>
      <p className="text-sm text-on-surface-variant">{subtitle}</p>
    </div>
  );
}

function Stat({ label, value, negative }: { label: string; value: string; negative?: boolean }) {
  return (
    <div>
      <dt className="text-sm text-on-surface-variant">{label}</dt>
      <dd className={`mt-1 text-lg font-semibold tabular-nums ${negative ? "text-expense" : "text-on-surface"}`}>
        {value}
      </dd>
    </div>
  );
}
