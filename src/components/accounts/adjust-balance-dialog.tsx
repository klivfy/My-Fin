"use client";

import { useState, useTransition } from "react";
import Decimal from "decimal.js";
import { SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createTransaction } from "@/actions/transactions";

/** Botão de ajuste rápido: corrige o saldo de uma conta lançando um ADJUSTMENT com o delta exato. */
export function AdjustBalanceDialog({ accountId, currentBalance }: { accountId: string; currentBalance: string }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(currentBalance);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit() {
    setError(null);
    let delta: Decimal;
    try {
      delta = new Decimal(value || "0").minus(new Decimal(currentBalance));
    } catch {
      setError("Valor inválido.");
      return;
    }
    if (delta.isZero()) {
      setOpen(false);
      return;
    }

    startTransition(async () => {
      try {
        await createTransaction({
          accountId,
          amount: delta.toFixed(2),
          type: "ADJUSTMENT",
          description: "Ajuste manual de saldo",
          date: new Date().toISOString(),
        });
        toast.success("Saldo ajustado.");
        setOpen(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao ajustar saldo.");
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setError(null);
      }}
    >
      <DialogTrigger
        render={
          <Button variant="ghost" size="icon" title="Ajustar saldo">
            <SlidersHorizontal className="size-4" />
          </Button>
        }
      />
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>Ajustar saldo</DialogTitle>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="new-balance">Novo saldo (R$)</Label>
          <Input
            id="new-balance"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        <FormError message={error} />
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={pending}>
            {pending ? "Salvando…" : "Confirmar ajuste"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
