"use client";

import { useState, useTransition } from "react";
import { Pencil, PiggyBank, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addGoalContribution, deleteGoal } from "@/actions/goals";
import { GoalDialog, type GoalFormValues } from "@/components/goals/goal-dialog";

/** Ações de uma meta: registrar aporte/retirada (sem conta vinculada), editar e excluir. */
export function GoalActions({
  goal,
  accounts,
  suggestedContribution,
}: {
  goal: GoalFormValues & { id: string };
  accounts: Array<{ id: string; name: string; linkedGoalId: string | null }>;
  suggestedContribution: number;
}) {
  const [pending, startTransition] = useTransition();

  function handleDelete() {
    if (!window.confirm(`Excluir a meta "${goal.name}"? O dinheiro guardado não é afetado.`)) return;
    startTransition(async () => {
      try {
        const result = await deleteGoal({ id: goal.id });
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        toast.success("Meta excluída.");
      } catch {
        toast.error("Erro ao excluir.");
      }
    });
  }

  return (
    <div className="flex items-center gap-1">
      {!goal.accountId && <ContributionDialog goalId={goal.id} suggested={suggestedContribution} />}
      <GoalDialog
        initial={goal}
        accounts={accounts}
        trigger={
          <Button size="icon" variant="ghost" aria-label={`Editar ${goal.name}`}>
            <Pencil className="size-4" />
          </Button>
        }
      />
      <Button size="icon" variant="ghost" onClick={handleDelete} disabled={pending} aria-label={`Excluir ${goal.name}`}>
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}

function ContributionDialog({ goalId, suggested }: { goalId: string; suggested: number }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [amount, setAmount] = useState("");
  const [withdraw, setWithdraw] = useState(false);

  function handleSubmit() {
    startTransition(async () => {
      try {
        const value = amount.trim();
        const result = await addGoalContribution({ id: goalId, amount: withdraw ? `-${value}` : value });
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        toast.success(withdraw ? "Retirada registrada." : "Aporte registrado.");
        setOpen(false);
      } catch {
        toast.error("Erro ao registrar.");
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setWithdraw(false);
          setAmount(suggested > 0 ? suggested.toFixed(2).replace(".", ",") : "");
        }
      }}
    >
      <DialogTrigger
        render={
          <Button size="sm" variant="outline" className="gap-1.5">
            <PiggyBank className="size-4" />
            Aporte
          </Button>
        }
      />
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{withdraw ? "Registrar retirada" : "Registrar aporte"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {[false, true].map((option) => (
              <button
                key={String(option)}
                type="button"
                onClick={() => setWithdraw(option)}
                className={`rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
                  withdraw === option
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input text-muted-foreground hover:bg-accent"
                }`}
              >
                {option ? "Retirada" : "Aporte"}
              </button>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contribution-amount">Valor (R$)</Label>
            <Input
              id="contribution-amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0,00"
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={pending || !amount.trim()}>
            {pending ? "Salvando…" : "Registrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
