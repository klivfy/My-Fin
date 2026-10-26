"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createSavingsGoal, deleteSavingsGoal } from "@/actions/savings-goals";

interface AccountOption {
  id: string;
  name: string;
}

/** Dialog de nova meta de poupança (valor-alvo + prazo + conta de destino). */
export function NewSavingsGoalDialog({ accounts }: { accounts: AccountOption[] }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [targetAmount, setTargetAmount] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");

  function handleSubmit() {
    if (!name.trim() || !targetAmount || !targetDate || !accountId) {
      toast.error("Preencha nome, valor-alvo, prazo e conta.");
      return;
    }
    startTransition(async () => {
      try {
        await createSavingsGoal({ name: name.trim(), targetAmount, targetDate, accountId });
        toast.success("Meta criada.");
        setOpen(false);
        setName("");
        setTargetAmount("");
        setTargetDate("");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Erro ao criar meta.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" className="gap-1.5">
            <Plus className="size-4" /> Nova meta
          </Button>
        }
      />
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>Nova meta de poupança</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="goal-name">Nome</Label>
            <Input id="goal-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Reserva de emergência" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="goal-amount">Valor-alvo (R$)</Label>
            <Input id="goal-amount" inputMode="decimal" value={targetAmount} onChange={(e) => setTargetAmount(e.target.value)} placeholder="0,00" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="goal-date">Prazo</Label>
            <Input id="goal-date" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Conta de destino</Label>
            <Select value={accountId} onValueChange={(v) => setAccountId(v as string)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={pending}>
            {pending ? "Salvando…" : "Criar meta"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Botão de excluir meta (não toca em transações nem saldo). */
export function DeleteSavingsGoalButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-7"
      title="Excluir meta"
      disabled={pending}
      onClick={() => {
        if (!confirm("Excluir esta meta?")) return;
        startTransition(async () => {
          try {
            await deleteSavingsGoal({ id });
            toast.success("Meta excluída.");
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Erro ao excluir meta.");
          }
        });
      }}
    >
      <Trash2 className="size-3.5" />
    </Button>
  );
}
