"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { deleteCategoryRule, upsertCategoryRule } from "@/actions/categories";

interface CategoryOption {
  id: string;
  name: string;
}

export interface RuleView {
  id: string;
  pattern: string;
  categoryId: string;
  categoryName: string;
  priority: number;
}

/** Gerenciador de regras de categorização automática (padrão → categoria). */
export function CategoryRulesPanel({
  rules,
  categories,
}: {
  rules: RuleView[];
  categories: CategoryOption[];
}) {
  const [pending, startTransition] = useTransition();
  const [pattern, setPattern] = useState("");
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [priority, setPriority] = useState("0");

  function handleAdd() {
    if (pattern.trim().length < 2 || !categoryId) {
      toast.error("Informe um padrão (mín. 2 caracteres) e a categoria.");
      return;
    }
    startTransition(async () => {
      try {
        await upsertCategoryRule({ pattern: pattern.trim(), categoryId, priority: Number(priority) || 0 });
        toast.success("Regra salva.");
        setPattern("");
        setPriority("0");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Erro ao salvar regra.");
      }
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      try {
        await deleteCategoryRule({ id });
        toast.success("Regra removida.");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Erro ao remover regra.");
      }
    });
  }

  return (
    <div className="space-y-3">
      <h2 className="flex items-center gap-2 text-base font-semibold text-on-surface">
        <Wand2 className="size-4" /> Regras de categorização
      </h2>
      <p className="text-xs text-on-surface-variant">
        Quando a descrição da transação contém o padrão, a categoria é atribuída automaticamente na
        importação (OFX/CSV) ou pelo botão Aplicar regras do extrato.
      </p>

      <div className="grid grid-cols-[1fr_auto_auto_auto] items-end gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Padrão (ex.: IFOOD)</Label>
          <Input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="Texto da descrição" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Categoria</Label>
          <Select value={categoryId} onValueChange={(v) => setCategoryId(v as string)}>
            <SelectTrigger className="w-40">
              <SelectValue />
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
        <div className="space-y-1">
          <Label className="text-xs">Prioridade</Label>
          <Input className="w-20" inputMode="numeric" value={priority} onChange={(e) => setPriority(e.target.value)} />
        </div>
        <Button size="sm" onClick={handleAdd} disabled={pending} className="gap-1.5">
          <Plus className="size-4" /> Adicionar
        </Button>
      </div>

      {rules.length > 0 && (
        <ul className="divide-y divide-outline-variant rounded-xl border border-outline-variant">
          {rules.map((rule) => (
            <li key={rule.id} className="flex items-center justify-between px-4 py-2 text-sm">
              <span className="text-on-surface">
                <code className="rounded bg-surface-container-high px-1.5 py-0.5 text-xs">{rule.pattern}</code>
                <span className="mx-2 text-on-surface-variant">→</span>
                {rule.categoryName}
                {rule.priority > 0 && (
                  <span className="ml-2 text-xs text-on-surface-variant">prioridade {rule.priority}</span>
                )}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                title="Remover regra"
                disabled={pending}
                onClick={() => handleDelete(rule.id)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
