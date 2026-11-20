"use client";

import { useState, useTransition } from "react";
import { Settings2 } from "lucide-react";
import { toast } from "sonner";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resetPotPercents, savePotPercents } from "@/actions/pots";

export interface PotPercentField {
  pot: string;
  label: string;
  percent: number;
}

const fmt = (n: number) => String(n).replace(".", ",");
const toNumber = (v: string) => Number(v.replace(",", ".")) || 0;

/** Edita os percentuais dos 6 potes. A soma precisa fechar 100%. */
export function PotPercentsDialog({ fields }: { fields: PotPercentField[] }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});

  const total = fields.reduce((acc, f) => acc + toNumber(values[f.pot] ?? fmt(f.percent)), 0);
  const roundedTotal = Math.round(total * 100) / 100;

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        const payload = Object.fromEntries(fields.map((f) => [f.pot, values[f.pot] ?? fmt(f.percent)]));
        const result = await savePotPercents(payload as Parameters<typeof savePotPercents>[0]);
        if (!result.ok) return setError(result.error);
        toast.success("Percentuais salvos.");
        setOpen(false);
      } catch {
        setError("Erro ao salvar. Tente de novo.");
      }
    });
  }

  function reset() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await resetPotPercents();
        if (!result.ok) return setError(result.error);
        toast.success("Voltou ao padrão 50/10/10/10/10/10.");
        setOpen(false);
      } catch {
        setError("Erro ao restaurar. Tente de novo.");
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setError(null);
        if (next) setValues(Object.fromEntries(fields.map((f) => [f.pot, fmt(f.percent)])));
      }}
    >
      <DialogTrigger
        render={
          <Button size="sm" variant="outline" className="gap-1.5">
            <Settings2 className="size-4" aria-hidden />
            Percentuais
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Percentuais dos potes</DialogTitle>
        </DialogHeader>
        <form
          id="pots-form"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          className="space-y-3"
        >
          <p className="text-sm text-on-surface-variant">
            O método propõe 50/10/10/10/10/10. Se as necessidades pesam mais que 50% da sua renda, ajuste: uma meta
            impossível só desanima.
          </p>
          <div className="grid grid-cols-2 gap-3">
            {fields.map((f) => (
              <div key={f.pot} className="space-y-1.5">
                <Label htmlFor={`pot-${f.pot}`}>{f.label} (%)</Label>
                <Input
                  id={`pot-${f.pot}`}
                  inputMode="decimal"
                  value={values[f.pot] ?? fmt(f.percent)}
                  onChange={(e) => setValues((v) => ({ ...v, [f.pot]: e.target.value }))}
                />
              </div>
            ))}
          </div>
          <p
            className={`text-sm tabular-nums ${roundedTotal === 100 ? "text-on-surface-variant" : "font-medium text-expense"}`}
            role="status"
          >
            Soma: {fmt(roundedTotal)}% {roundedTotal === 100 ? "" : "(precisa ser 100%)"}
          </p>
        </form>
        <FormError message={error} />
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={reset} disabled={pending}>
            Voltar ao padrão
          </Button>
          <Button type="submit" form="pots-form" disabled={pending || roundedTotal !== 100}>
            {pending ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
