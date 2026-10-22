"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Money } from "@/components/money";
import { formatDateShort } from "@/lib/format";
import { categorizeTransaction } from "@/actions/categorization";
import type { ReviewCategory, ReviewTransaction } from "@/lib/queries/categorization";

/** Uma transação pendente: escolher categoria e, opcionalmente, virar regra. */
export function ReviewRow({
  transaction,
  categories,
}: {
  transaction: ReviewTransaction;
  categories: ReviewCategory[];
}) {
  const [pending, startTransition] = useTransition();
  const [categoryId, setCategoryId] = useState("");
  const [createRule, setCreateRule] = useState(false);
  const [rulePattern, setRulePattern] = useState(transaction.description);

  const options = categories.filter((category) => category.type === transaction.type);

  function handleSave() {
    if (!categoryId) {
      toast.error("Escolha uma categoria.");
      return;
    }
    startTransition(async () => {
      try {
        const result = await categorizeTransaction({
          transactionId: transaction.id,
          categoryId,
          rulePattern: createRule ? rulePattern : undefined,
        });
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        const { appliedToOthers } = result.data;
        toast.success(
          appliedToOthers > 0
            ? `Categorizada. A regra também resolveu outras ${appliedToOthers} pendente(s).`
            : "Categorizada.",
        );
      } catch {
        toast.error("Erro ao categorizar.");
      }
    });
  }

  return (
    <li className="space-y-3 rounded-2xl border border-outline-variant bg-surface-container-low p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-on-surface" title={transaction.description}>
            {transaction.description}
          </p>
          <p className="text-xs text-on-surface-variant">
            {formatDateShort(transaction.date)} · {transaction.accountName}
          </p>
        </div>
        <Money value={transaction.amount} className="shrink-0 text-sm" />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select value={categoryId} onValueChange={(value) => setCategoryId(value as string)}>
          <SelectTrigger className="w-full sm:w-56">
            <SelectValue placeholder="Escolha a categoria" />
          </SelectTrigger>
          <SelectContent>
            {options.map((category) => (
              <SelectItem key={category.id} value={category.id}>
                {category.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <label className="flex items-center gap-2 text-xs text-on-surface-variant">
          <Checkbox checked={createRule} onCheckedChange={(checked) => setCreateRule(checked === true)} />
          Sempre que a descrição contiver…
        </label>

        <Button size="sm" onClick={handleSave} disabled={pending} className="sm:ml-auto">
          {pending ? "Salvando…" : "Salvar"}
        </Button>
      </div>

      {createRule && (
        <Input
          value={rulePattern}
          onChange={(e) => setRulePattern(e.target.value)}
          placeholder="Trecho da descrição (ex.: IFOOD)"
          aria-label="Trecho da descrição para a regra"
        />
      )}
    </li>
  );
}
