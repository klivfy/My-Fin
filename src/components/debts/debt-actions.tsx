"use client";

import { useState, useTransition } from "react";
import { CheckCheck, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DebtDialog, type DebtFormValues } from "@/components/debts/debt-dialog";
import { deleteDebt, payInstallment } from "@/actions/debts";

/** Ações de uma dívida: registrar parcela paga, editar e excluir. */
export function DebtActions({ debt }: { debt: DebtFormValues & { id: string; remainingCount: number } }) {
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<"pay" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const last = debt.remainingCount <= 1;

  function run(kind: "pay" | "delete") {
    setError(null);
    startTransition(async () => {
      try {
        if (kind === "pay") {
          const result = await payInstallment({ id: debt.id });
          if (!result.ok) return setError(result.error);
          toast.success(result.data.paidOff ? `${debt.name} quitada.` : "Parcela registrada.");
        } else {
          const result = await deleteDebt({ id: debt.id });
          if (!result.ok) return setError(result.error);
          toast.success("Dívida excluída.");
        }
        setConfirm(null);
      } catch {
        setError("Erro ao salvar. Tente de novo.");
      }
    });
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5"
        onClick={() => {
          setError(null);
          setConfirm("pay");
        }}
        disabled={pending}
      >
        <CheckCheck className="size-4" aria-hidden />
        Paguei 1
        <span className="sr-only">parcela de {debt.name}</span>
      </Button>
      <DebtDialog
        initial={debt}
        trigger={
          <Button size="icon" variant="ghost" aria-label={`Editar ${debt.name}`}>
            <Pencil className="size-4" />
          </Button>
        }
      />
      <Button
        size="icon"
        variant="ghost"
        aria-label={`Excluir ${debt.name}`}
        onClick={() => {
          setError(null);
          setConfirm("delete");
        }}
        disabled={pending}
      >
        <Trash2 className="size-4" />
      </Button>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={
          confirm === "delete"
            ? `Excluir "${debt.name}"?`
            : last
              ? `Registrar a última parcela de "${debt.name}"?`
              : `Registrar uma parcela paga de "${debt.name}"?`
        }
        description={
          confirm === "delete"
            ? "Sai da lista e do plano. Use quando cadastrou errado; para quitação, registre as parcelas pagas."
            : last
              ? "A dívida fica quitada e sai do plano."
              : `Ficam ${debt.remainingCount - 1} parcelas. O plano é recalculado a partir daí.`
        }
        confirmLabel={confirm === "delete" ? "Excluir dívida" : "Registrar parcela"}
        destructive={confirm === "delete"}
        pending={pending}
        error={error}
        onConfirm={() => confirm && run(confirm)}
      />
    </div>
  );
}
