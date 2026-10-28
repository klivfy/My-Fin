"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createGoal, updateGoal } from "@/actions/goals";

const NO_ACCOUNT = "none";

export interface GoalFormValues {
  id?: string;
  name: string;
  targetAmount: string;
  /** YYYY-MM-DD ou vazio. */
  targetDate: string;
  accountId: string | null;
}

/** Diálogo de criar/editar meta. `trigger` é o botão que o abre. */
export function GoalDialog({
  trigger,
  initial,
  accounts,
}: {
  trigger: React.ReactElement;
  initial: GoalFormValues;
  accounts: Array<{ id: string; name: string; linkedGoalId: string | null }>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState(initial);
  const isEdit = Boolean(initial.id);

  // Contas livres, mais a que já financia esta própria meta.
  const options = accounts.filter((a) => !a.linkedGoalId || a.linkedGoalId === initial.id);

  function handleSubmit() {
    startTransition(async () => {
      try {
        const payload = {
          name: values.name,
          targetAmount: values.targetAmount,
          targetDate: values.targetDate,
          accountId: values.accountId,
        };
        const result = initial.id ? await updateGoal({ ...payload, id: initial.id }) : await createGoal(payload);
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        toast.success(isEdit ? "Meta atualizada." : "Meta criada.");
        setOpen(false);
      } catch {
        toast.error("Erro ao salvar a meta.");
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setValues(initial);
      }}
    >
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar meta" : "Nova meta de poupança"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="goal-name">Nome</Label>
            <Input
              id="goal-name"
              value={values.name}
              onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
              placeholder="Ex.: Reserva de emergência"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="goal-target">Valor da meta (R$)</Label>
              <Input
                id="goal-target"
                inputMode="decimal"
                value={values.targetAmount}
                onChange={(e) => setValues((v) => ({ ...v, targetAmount: e.target.value }))}
                placeholder="0,00"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="goal-date">Até quando (opcional)</Label>
              <Input
                id="goal-date"
                type="date"
                value={values.targetDate}
                onChange={(e) => setValues((v) => ({ ...v, targetDate: e.target.value }))}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Onde o dinheiro fica</Label>
            <Select
              value={values.accountId ?? NO_ACCOUNT}
              onValueChange={(value) => setValues((v) => ({ ...v, accountId: value === NO_ACCOUNT ? null : (value as string) }))}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_ACCOUNT}>Nenhuma conta — registro os aportes</SelectItem>
                {options.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    Saldo da conta {account.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-on-surface-variant">
              Com uma conta vinculada, o progresso acompanha o saldo dela automaticamente.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={pending}>
            {pending ? "Salvando…" : isEdit ? "Salvar" : "Criar meta"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
