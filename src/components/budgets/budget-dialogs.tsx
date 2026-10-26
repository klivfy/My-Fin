"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus } from "lucide-react";
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
import { updateCategory } from "@/actions/categories";
import { createCategory } from "@/actions/categories";

/** Edição rápida do teto orçamentário direto no card de Orçamentos. */
export function EditBudgetDialog({
  categoryId,
  name,
  currentLimit,
}: {
  categoryId: string;
  name: string;
  currentLimit: number;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(currentLimit.toFixed(2).replace(".", ","));
  const [pending, startTransition] = useTransition();

  function handleSubmit() {
    startTransition(async () => {
      try {
        await updateCategory({ id: categoryId, budgetLimit: value });
        toast.success("Orçamento atualizado.");
        setOpen(false);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Erro ao atualizar orçamento.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="icon" className="size-7" title={`Editar teto de ${name}`}>
            <Pencil className="size-3.5" />
          </Button>
        }
      />
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>Teto mensal — {name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="budget-limit">Limite (R$)</Label>
          <Input id="budget-limit" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
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

/** Criação de categoria de despesa com teto (botão do cabeçalho de Orçamentos). */
export function NewBudgetCategoryDialog() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [limit, setLimit] = useState("");
  const [color, setColor] = useState("#3949AB");

  function handleSubmit() {
    if (!name.trim()) {
      toast.error("Informe o nome da categoria.");
      return;
    }
    startTransition(async () => {
      try {
        await createCategory({
          name: name.trim(),
          type: "EXPENSE",
          color,
          budgetLimit: limit || null,
        });
        toast.success("Categoria criada.");
        setOpen(false);
        setName("");
        setLimit("");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Erro ao criar categoria.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm" className="gap-1.5">
            <Plus className="size-4" /> Novo orçamento
          </Button>
        }
      />
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>Nova categoria com teto</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="cat-name">Nome</Label>
            <Input id="cat-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Restaurantes" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cat-limit">Teto mensal (R$)</Label>
            <Input id="cat-limit" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="0,00" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cat-color">Cor</Label>
            <Input id="cat-color" type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 w-full" />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={pending}>
            {pending ? "Salvando…" : "Criar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
