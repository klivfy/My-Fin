"use client";

import { useState, useTransition } from "react";
import { Pencil } from "lucide-react";
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
import { updateTransaction } from "@/actions/transactions";
import type { TransactionRow } from "./transactions-table";

interface CategoryOption {
  id: string;
  name: string;
}

/** Edição inline de uma transação manual (bloqueada no servidor para pernas de transferência/fatura). */
export function EditTransactionDialog({
  row,
  categories,
}: {
  row: TransactionRow;
  categories: CategoryOption[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const isEditable = row.type === "INCOME" || row.type === "EXPENSE" || row.type === "ADJUSTMENT";

  const [description, setDescription] = useState(row.description);
  const [amount, setAmount] = useState(
    Math.abs(Number(row.amount)).toFixed(2).replace(".", ","),
  );
  const [date, setDate] = useState(row.date.slice(0, 10));
  const [categoryId, setCategoryId] = useState(row.category?.id ?? "");

  function handleSubmit() {
    if (!description.trim() || !amount) {
      toast.error("Preencha descrição e valor.");
      return;
    }
    startTransition(async () => {
      try {
        await updateTransaction({
          id: row.id,
          description: description.trim(),
          amount,
          date,
          categoryId: categoryId || null,
        });
        toast.success("Transação atualizada.");
        setOpen(false);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Erro ao atualizar transação.");
      }
    });
  }

  if (!isEditable) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="icon" className="size-7" title="Editar transação">
            <Pencil className="size-3.5" />
          </Button>
        }
      />
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Editar transação</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit-desc">Descrição</Label>
            <Input id="edit-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-amount">Valor absoluto (R$)</Label>
              <Input id="edit-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-date">Data</Label>
              <Input id="edit-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Categoria</Label>
            <Select value={categoryId} onValueChange={(v) => setCategoryId(v as string)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Sem categoria" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {row.type === "ADJUSTMENT" && (
            <p className="text-xs text-on-surface-variant">
              Ajustes preservam o sinal informado; receitas/despesas têm o sinal aplicado pelo tipo.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={pending}>
            {pending ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
