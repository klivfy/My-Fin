import Link from "next/link";
import { AlertTriangle, Scissors } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Money } from "@/components/money";
import { formatBRL, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BucketView, BudgetRuleView, CategoryLine } from "@/lib/queries/budget-rule";

type BucketKind = "need" | "want" | "savings";

const BUCKETS: Record<BucketKind, { label: string; barClass: string; higherIsBetter: boolean }> = {
  need: { label: "Necessidades", barClass: "bg-primary", higherIsBetter: false },
  want: { label: "Desejos", barClass: "bg-transfer", higherIsBetter: false },
  savings: { label: "Poupança", barClass: "bg-income", higherIsBetter: true },
};

function splitLabel(split: BudgetRuleView["split"]): string {
  return [split.need, split.want, split.savings].map((v) => Math.round(v * 100)).join("/");
}

/** Regra 50/30/20 do período: real vs. meta, método recomendado e cortes sugeridos. */
export function BudgetRuleCard({ view }: { view: BudgetRuleView }) {
  if (view.income <= 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Regra 50/30/20 · {view.periodLabel}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-on-surface-variant">
            Nenhuma receita no período. A regra compara seus gastos com o que entrou — escolha outro período ou
            importe o extrato com suas receitas.
          </p>
        </CardContent>
      </Card>
    );
  }

  const buckets: Array<{ kind: BucketKind; bucket: BucketView; targetShare: number; categories: CategoryLine[] }> = [
    { kind: "need", bucket: view.needs, targetShare: view.split.need, categories: view.needCategories },
    { kind: "want", bucket: view.wants, targetShare: view.split.want, categories: view.wantCategories },
    { kind: "savings", bucket: view.savings, targetShare: view.split.savings, categories: view.savingsCategories },
  ];

  return (
    <Card>
      <CardHeader className="space-y-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <CardTitle className="text-sm font-medium">Regra 50/30/20 · {view.periodLabel}</CardTitle>
          <span className="text-xs text-on-surface-variant">
            Receitas: <Money value={view.income} tone="income" showSign={false} className="text-xs" />
          </span>
        </div>
        <p className="text-xs text-on-surface-variant">
          <span className="mr-1 rounded-full bg-secondary px-2 py-0.5 font-medium text-secondary-foreground">
            Método {splitLabel(view.split)}
          </span>
          {view.splitReason}
        </p>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="space-y-4">
          {buckets.map(({ kind, bucket, targetShare, categories }) => (
            <BucketRow key={kind} kind={kind} bucket={bucket} targetShare={targetShare} categories={categories} />
          ))}
        </div>

        {view.unclassified.total > 0 && (
          <div className="flex items-start gap-2 rounded-xl bg-transfer-container px-3 py-2 text-xs text-transfer-on-container">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <p>
              {formatBRL(view.unclassified.total)} em despesas sem natureza (
              {view.unclassified.categories.map((c) => c.name).join(", ")}) ficaram fora dos baldes.{" "}
              <Link href="/review" className="font-medium underline underline-offset-2">
                Classifique em Revisar
              </Link>{" "}
              para o retrato ficar completo.
            </p>
          </div>
        )}

        <CutsSection view={view} />
      </CardContent>
    </Card>
  );
}

function BucketRow({
  kind,
  bucket,
  targetShare,
  categories,
}: {
  kind: BucketKind;
  bucket: BucketView;
  targetShare: number;
  categories: CategoryLine[];
}) {
  const config = BUCKETS[kind];
  const share = bucket.actualShare ?? 0;
  const onTrack = config.higherIsBetter ? bucket.actual >= bucket.target : bucket.actual <= bucket.target;
  // Escala da barra: 100% da receita; o marcador indica a meta.
  const barPct = Math.max(0, Math.min(1, share)) * 100;

  return (
    <details className="group">
      <summary className="cursor-pointer list-none space-y-1.5 [&::-webkit-details-marker]:hidden">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="text-sm font-medium text-on-surface">{config.label}</span>
          <span className="flex items-baseline gap-2 text-xs text-on-surface-variant">
            <Money value={bucket.actual} tone="neutral" showSign={kind === "savings" && bucket.actual < 0} className="text-sm" />
            <span>
              {formatPercent(share, 0)} da receita · meta {formatPercent(targetShare, 0)}
            </span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-medium",
                onTrack ? "bg-income-container text-income-on-container" : "bg-expense-container text-expense-on-container",
              )}
            >
              {onTrack ? "Na meta" : config.higherIsBetter ? "Abaixo" : "Acima"}
            </span>
          </span>
        </div>
        <div className="relative h-2 w-full overflow-hidden rounded-full bg-surface-container-highest">
          <div className={cn("h-full rounded-full", config.barClass)} style={{ width: `${barPct}%` }} />
          <div
            className="absolute top-0 h-full w-0.5 bg-on-surface/60"
            style={{ left: `${targetShare * 100}%` }}
            title={`Meta: ${formatPercent(targetShare, 0)}`}
          />
        </div>
      </summary>

      <ul className="mt-2 space-y-1 border-l border-outline-variant pl-3">
        {categories.length === 0 && (
          <li className="text-xs text-on-surface-variant">
            {kind === "savings" ? "Só a sobra do período." : "Nenhuma categoria com esta natureza no período."}
          </li>
        )}
        {categories.map((category) => (
          <li key={category.id} className="flex items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-1.5 text-on-surface">
              <span className="size-2 rounded-full" style={{ backgroundColor: category.color }} />
              {category.name}
            </span>
            <span className="tabular-nums text-on-surface-variant">{formatBRL(category.spent)}</span>
          </li>
        ))}
        {kind === "savings" && categories.length > 0 && (
          <li className="text-xs text-on-surface-variant">+ a sobra do período.</li>
        )}
      </ul>
    </details>
  );
}

function CutsSection({ view }: { view: BudgetRuleView }) {
  if (view.cuts.gap <= 0) {
    return (
      <p className="text-xs text-on-surface-variant">
        Meta de poupança atingida no período — nenhum corte necessário.
      </p>
    );
  }

  return (
    <div className="space-y-2 rounded-xl border border-outline-variant p-3">
      <p className="flex items-center gap-2 text-sm font-medium text-on-surface">
        <Scissors className="size-4" />
        Faltam {formatBRL(view.cuts.gap)} para a meta de poupança
      </p>
      {view.cuts.suggestions.length > 0 && (
        <>
          <p className="text-xs text-on-surface-variant">
            Cortes sugeridos em Desejos, proporcionais ao gasto de cada categoria:
          </p>
          <ul className="space-y-1">
            {view.cuts.suggestions.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-on-surface">{s.name}</span>
                <span className="tabular-nums text-on-surface-variant">
                  −{formatBRL(s.cut)} <span className="opacity-70">de {formatBRL(s.spent)}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {view.cuts.uncovered > 0 && (
        <p className="text-xs text-expense">
          Mesmo cortando todos os Desejos, faltariam {formatBRL(view.cuts.uncovered)} — será preciso rever
          Necessidades ou aumentar a receita.
        </p>
      )}
    </div>
  );
}
