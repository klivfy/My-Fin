"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
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
import { createTransaction } from "@/actions/transactions";

export interface AccountOption {
  id: string;
  name: string;
}

export interface CategoryOption {
  id: string;
  name: string;
  type: "INCOME" | "EXPENSE";
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Extended FAB "+ Nova transação" — abre um diálogo com lançamento manual imediato. */
export function NewTransactionDialog({
  accounts,
  categories,
}: {
  accounts: AccountOption[];
  categories: CategoryOption[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const [type, setType] = useState<"INCOME" | "EXPENSE" | "ADJUSTMENT">("EXPENSE");
  const [accountId, setAccountId] = useState<string>(accounts[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(todayIsoDate());

  const filteredCategories = categories.filter((category) => category.type === type);

  function resetForm() {
    setType("EXPENSE");
    setAccountId(accounts[0]?.id ?? "");
    setCategoryId("");
    setAmount("");
    setDescription("");
    setDate(todayIsoDate());
  }

  function handleSubmit() {
    if (!accountId || !amount || !description.trim()) {
      toast.error("Preencha conta, valor e descrição.");
      return;
    }

    startTransition(async () => {
      try {
        await createTransaction({
          accountId,
          categoryId: categoryId || null,
          amount,
          type,
          description,
          date,
        });
        toast.success("Transação criada.");
        setOpen(false);
        resetForm();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Erro ao criar transação.");
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) resetForm();
      }}
    >
      <DialogTrigger
        render={
          <Button size="lg" className="h-10 gap-2 px-3">
            <Plus className="size-4" aria-hidden />
            <span className="sr-only sm:not-sr-only">Nova transação</span>
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nova transação</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {(["EXPENSE", "INCOME", "ADJUSTMENT"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  setType(option);
                  setCategoryId("");
                }}
                className={`rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
                  type === option
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input text-muted-foreground hover:bg-accent"
                }`}
              >
                {option === "EXPENSE" ? "Despesa" : option === "INCOME" ? "Receita" : "Ajuste"}
              </button>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tx-description">Descrição</Label>
            <Input
              id="tx-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ex.: Supermercado"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="tx-amount">Valor (R$)</Label>
              <Input
                id="tx-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0,00"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tx-date">Data</Label>
              <Input id="tx-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Conta</Label>
            <Select value={accountId} onValueChange={(value) => setAccountId(value as string)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Selecione a conta" />
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

          {filteredCategories.length > 0 && (
            <div className="space-y-1.5">
              <Label>Categoria (opcional)</Label>
              <Select value={categoryId} onValueChange={(value) => setCategoryId(value as string)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Sem categoria" />
                </SelectTrigger>
                <SelectContent>
                  {filteredCategories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={pending}>
            {pending ? "Salvando…" : "Salvar transação"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
