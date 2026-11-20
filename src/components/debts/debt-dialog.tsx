"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createDebt, updateDebt } from "@/actions/debts";

export interface DebtFormValues {
  id?: string;
  name: string;
  installment: string;
  remaining: string;
  monthlyRatePct: string;
}

export const EMPTY_DEBT: DebtFormValues = { name: "", installment: "", remaining: "", monthlyRatePct: "" };

/** Diálogo de criar/editar dívida. `trigger` é o botão que o abre. */
export function DebtDialog({ trigger, initial = EMPTY_DEBT }: { trigger: React.ReactElement; initial?: DebtFormValues }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState(initial);
  const isEdit = Boolean(initial.id);
  const set = (key: keyof DebtFormValues) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const payload = {
          name: values.name,
          installment: values.installment,
          remaining: values.remaining,
          monthlyRatePct: values.monthlyRatePct,
        };
        const result = initial.id ? await updateDebt({ ...payload, id: initial.id }) : await createDebt(payload);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        toast.success(isEdit ? "Dívida atualizada." : "Dívida adicionada.");
        setOpen(false);
      } catch {
        setError("Erro ao salvar a dívida. Tente de novo.");
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setError(null);
        if (next) setValues(initial);
      }}
    >
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar dívida" : "Nova dívida"}</DialogTitle>
        </DialogHeader>

        <form id="debt-form" onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="debt-name">Nome</Label>
            <Input id="debt-name" value={values.name} onChange={set("name")} placeholder="Ex.: Acordo do cartão" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="debt-installment">Parcela (R$)</Label>
              <Input
                id="debt-installment"
                inputMode="decimal"
                value={values.installment}
                onChange={set("installment")}
                placeholder="0,00"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="debt-remaining">Parcelas que faltam</Label>
              <Input
                id="debt-remaining"
                inputMode="numeric"
                value={values.remaining}
                onChange={set("remaining")}
                placeholder="Ex.: 18"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="debt-rate">Juro ao mês (%)</Label>
            <Input
              id="debt-rate"
              inputMode="decimal"
              value={values.monthlyRatePct}
              onChange={set("monthlyRatePct")}
              placeholder="Ex.: 9,5"
              aria-describedby="debt-rate-hint"
            />
            <p id="debt-rate-hint" className="text-xs text-on-surface-variant">
              Está no contrato ou no boleto como &ldquo;taxa de juros a.m.&rdquo; ou CET mensal. Use o CET quando
              houver: ele inclui tarifas e seguros.
            </p>
          </div>
        </form>

        <FormError message={error} />
        <DialogFooter>
          <Button type="submit" form="debt-form" disabled={pending}>
            {pending ? "Salvando…" : isEdit ? "Salvar" : "Adicionar dívida"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
