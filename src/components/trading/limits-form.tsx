"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveTradeLimits } from "@/actions/trading";
import type { LimitsView } from "@/lib/queries/trading";

const money = (v: number | null) =>
  v === null ? "" : new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2 }).format(v);

/**
 * Limites para o painel. Ficam só no banco do app (nunca no repositório).
 * Copie os mesmos números do seu config.json do trader-b3: é ele que vale.
 */
export function LimitsForm({ limits }: { limits: LimitsView }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await saveTradeLimits({
        maxLossDay: String(f.get("maxLossDay") ?? ""),
        maxLossMonth: String(f.get("maxLossMonth") ?? ""),
        pauseDaysAfterMonth: String(f.get("pauseDaysAfterMonth") ?? ""),
        maxTradesDay: String(f.get("maxTradesDay") ?? ""),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      toast.success("Limites salvos.");
    });
  }

  return (
    <form onSubmit={onSubmit} className="max-w-2xl space-y-4" aria-describedby={error ? "limits-error" : undefined}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="maxLossDay"
          label="Perda máxima no dia (R$)"
          hint="perda_max_dia"
          defaultValue={money(limits.maxLossDay)}
          inputMode="decimal"
        />
        <Field
          id="maxLossMonth"
          label="Perda máxima no mês (R$)"
          hint="perda_max_mes"
          defaultValue={money(limits.maxLossMonth)}
          inputMode="decimal"
        />
        <Field
          id="maxTradesDay"
          label="Entradas por dia"
          hint="max_operacoes_dia"
          defaultValue={limits.maxTradesDay?.toString() ?? ""}
          inputMode="numeric"
        />
        <Field
          id="pauseDaysAfterMonth"
          label="Pausa após o limite do mês (dias)"
          hint="pausa_dias_apos_mes; vazio usa 7"
          defaultValue={limits.pauseDaysAfterMonth?.toString() ?? ""}
          inputMode="numeric"
        />
      </div>
      {error && (
        <p id="limits-error" role="alert" className="text-sm text-expense">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={pending}>
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        Salvar limites
      </Button>
    </form>
  );
}

function Field({
  id,
  label,
  hint,
  defaultValue,
  inputMode,
}: {
  id: string;
  label: string;
  hint: string;
  defaultValue: string;
  inputMode: "decimal" | "numeric";
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={id}
        defaultValue={defaultValue}
        inputMode={inputMode}
        autoComplete="off"
        aria-describedby={`${id}-hint`}
        className="h-10 text-base tabular-nums sm:text-sm"
      />
      <p id={`${id}-hint`} className="text-xs text-on-surface-variant">
        No config.json: <code className="font-mono">{hint}</code>
      </p>
    </div>
  );
}
