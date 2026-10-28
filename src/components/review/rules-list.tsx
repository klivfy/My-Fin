"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { deleteCategorizationRule } from "@/actions/categorization";
import type { ReviewRule } from "@/lib/queries/categorization";

/** Regras aplicadas automaticamente a cada importação de extrato. */
export function RulesList({ rules }: { rules: ReviewRule[] }) {
  if (rules.length === 0) {
    return (
      <p className="text-sm text-on-surface-variant">
        Nenhuma regra ainda. Ao categorizar uma pendente, marque “Sempre que a descrição contiver…” para criar uma.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-outline-variant">
      {rules.map((rule) => (
        <RuleRow key={rule.id} rule={rule} />
      ))}
    </ul>
  );
}

function RuleRow({ rule }: { rule: ReviewRule }) {
  const [pending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      try {
        await deleteCategorizationRule({ id: rule.id });
        toast.success("Regra removida.");
      } catch {
        toast.error("Erro ao remover regra.");
      }
    });
  }

  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <p className="min-w-0 text-sm text-on-surface">
        <span className="font-mono text-xs">{rule.pattern}</span>
        <span className="text-on-surface-variant"> → {rule.categoryName}</span>
      </p>
      <Button
        size="icon"
        variant="ghost"
        onClick={handleDelete}
        disabled={pending}
        aria-label={`Remover regra ${rule.pattern}`}
      >
        <Trash2 className="size-4" />
      </Button>
    </li>
  );
}
