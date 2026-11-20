import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { DismissButton, RestoreButton } from "@/components/insights/dismiss-button";
import type { NextSteps } from "@/lib/queries/insights";

/**
 * "Próximos passos": até 3 sugestões vindas do retrato financeiro, na ordem da
 * fila (reserva, dívida cara, reserva completa, metas, livre). Lista de linhas,
 * não de cartões: cada uma tem o porquê escrito e a tela onde se age.
 */
export function NextStepsPanel({ data }: { data: NextSteps }) {
  if (data.suggestions.length === 0 && data.dismissedCount === 0) return null;

  return (
    <section
      aria-labelledby="proximos-passos"
      className="rounded-xl border border-outline-variant bg-surface-container-lowest"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
        <h2 id="proximos-passos" className="text-sm font-medium text-on-surface">
          Próximos passos
        </h2>
        {data.dismissedCount > 0 && <RestoreButton count={data.dismissedCount} />}
      </div>

      {data.suggestions.length === 0 ? (
        <p className="px-5 pb-4 pt-2 text-sm text-on-surface-variant">Nenhuma sugestão em aberto.</p>
      ) : (
        <ol className="divide-y divide-outline-variant">
          {data.suggestions.map((s, i) => (
            <li key={s.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 py-3">
              <div className="min-w-0 flex-1 basis-72 space-y-0.5">
                <p className="text-sm font-medium text-on-surface">
                  <span className="mr-1.5 tabular-nums text-on-surface-variant">{i + 1}.</span>
                  {s.title}
                </p>
                <p className="text-xs text-on-surface-variant">{s.detail}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Link
                  href={s.href}
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-primary hover:bg-secondary"
                >
                  {s.cta}
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
                <DismissButton id={s.id} title={s.title} />
              </div>
            </li>
          ))}
        </ol>
      )}

      <p className="px-5 pb-4 pt-2 text-xs text-on-surface-variant">
        Sugestões educativas calculadas com os seus números, na ordem da fila. Não indicam ativos nem substituem
        aconselhamento financeiro.
      </p>
    </section>
  );
}
