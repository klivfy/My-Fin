import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PotPercentsDialog } from "@/components/budgets/pot-percents-dialog";
import { formatBRL, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PotLineView, PotsView } from "@/lib/queries/pots";

const pctText = (n: number) => `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(n)}%`;

/** Os 6 potes do período: meta (percentual da receita), usado e o que ainda cabe. */
export function PotsCard({ view, entradaParam }: { view: PotsView; entradaParam: string }) {
  const fields = view.lines.map((l) => ({ pot: l.pot, label: l.label, percent: l.percent }));

  return (
    <Card>
      <CardHeader className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium">6 potes · {view.periodLabel}</CardTitle>
          <PotPercentsDialog fields={fields} />
        </div>
        <p className="text-xs text-on-surface-variant">
          Cada entrada é dividida em percentuais fixos. Aqui os potes olham as despesas que você já categoriza: cada
          categoria mora num pote (defina em{" "}
          <Link href="/review" className="font-medium text-primary underline-offset-4 hover:underline">
            Revisar
          </Link>
          ).
        </p>
      </CardHeader>

      <CardContent className="space-y-5">
        {view.income > 0 ? (
          <ul className="space-y-4">
            {view.lines.map((line) => (
              <PotRow key={line.pot} line={line} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-on-surface-variant">
            Nenhuma receita no período, então os potes ainda não têm meta. Use a divisão de uma entrada abaixo ou
            escolha outro período.
          </p>
        )}

        {view.unassigned > 0 && (
          <p className="text-xs text-on-surface-variant">
            <span className="font-medium text-on-surface tabular-nums">{formatBRL(view.unassigned)}</span> em despesas
            ficaram sem pote (sem categoria ou sem natureza). Não foram jogadas em nenhum pote.
          </p>
        )}

        <div className="space-y-3 border-t border-outline-variant pt-4">
          <h3 className="text-sm font-medium text-on-surface">Dividir uma entrada</h3>
          <form method="get" className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="entrada">Valor que entrou (R$)</Label>
              <Input
                id="entrada"
                name="entrada"
                inputMode="decimal"
                defaultValue={entradaParam}
                placeholder="3.000,00"
                className="w-40"
              />
            </div>
            <Button type="submit" variant="outline">
              Dividir
            </Button>
          </form>
          {view.split ? (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
              {view.split.parts.map((p) => (
                <div key={p.pot}>
                  <dt className="text-xs text-on-surface-variant">{p.label}</dt>
                  <dd className="text-sm font-semibold tabular-nums text-on-surface">{formatBRL(p.value)}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-xs text-on-surface-variant">
              Quando o próximo dinheiro entrar, divida nos potes, nem que seja R$ 1. O hábito vale mais que o valor.
            </p>
          )}
        </div>

        <p className="text-xs text-on-surface-variant">
          Diversão é um teto, não uma obrigação de gastar: o método sugere zerar esse pote todo mês, mas gastar para
          &ldquo;cumprir&rdquo; a meta só piora o orçamento. Ferramenta educativa, não é aconselhamento financeiro.
        </p>
      </CardContent>
    </Card>
  );
}

function PotRow({ line }: { line: PotLineView }) {
  const save = line.kind === "save";
  const share = line.usedShare ?? 0;
  const barPct = Math.min(1, share) * 100;
  const over = !save && line.used > line.target;

  return (
    <li className="space-y-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <div>
          <span className="text-sm font-medium text-on-surface">{line.label}</span>{" "}
          <span className="text-xs text-on-surface-variant">
            {pctText(line.percent)} · {line.hint}
          </span>
        </div>
        <span className="text-sm tabular-nums text-on-surface">
          {formatBRL(line.used)} <span className="text-xs text-on-surface-variant">de {formatBRL(line.target)}</span>
        </span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-surface-container-highest"
        role="progressbar"
        aria-label={`${line.label}: ${formatPercent(share, 0)} da meta`}
        aria-valuenow={Math.round(barPct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cn("h-full rounded-full", over ? "bg-expense" : save ? "bg-income" : "bg-primary")}
          style={{ width: `${barPct}%` }}
        />
      </div>
      <p className={cn("flex items-center gap-1 text-xs", line.attention ? "font-medium text-expense" : "text-on-surface-variant")}>
        {line.attention && <AlertTriangle className="size-3.5 shrink-0" aria-hidden />}
        {save
          ? line.attention
            ? `faltam ${formatBRL(line.remaining)} para guardar`
            : line.target > 0
              ? "meta de guardar atingida"
              : "sem meta no período"
          : over
            ? `passou ${formatBRL(line.used - line.target)} do pote`
            : `ainda cabem ${formatBRL(line.remaining)}`}
        {line.categories.length > 0 && (
          <span className="font-normal text-on-surface-variant">
            {" "}
            · {line.categories.slice(0, 3).map((c) => c.name).join(", ")}
            {line.categories.length > 3 && ` +${line.categories.length - 3}`}
          </span>
        )}
      </p>
    </li>
  );
}
