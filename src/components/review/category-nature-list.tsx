"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { setCategoryNature, setCategoryPot } from "@/actions/categorization";
import { POT_ORDER, POTS, resolvePot } from "@/lib/financial-engine/pots";
import type { ReviewCategory } from "@/lib/queries/categorization";
import type { Pot } from "@/lib/financial-engine/pots";

const NATURES = [
  { value: "NEED", label: "Necessidade" },
  { value: "WANT", label: "Desejo" },
  { value: "SAVINGS", label: "Poupança" },
] as const;

/** Marca cada categoria de despesa como Necessidade, Desejo ou Poupança (50/30/20) e escolhe o pote dela. */
export function CategoryNatureList({
  categories,
}: {
  categories: ReviewCategory[];
}) {
  const expenseCategories = categories.filter(
    (category) => category.type === "EXPENSE",
  );

  return (
    <ul className="divide-y divide-outline-variant">
      {expenseCategories.map((category) => (
        <NatureRow key={category.id} category={category} />
      ))}
    </ul>
  );
}

function NatureRow({ category }: { category: ReviewCategory }) {
  const [pending, startTransition] = useTransition();

  function handleSelect(nature: (typeof NATURES)[number]["value"]) {
    startTransition(async () => {
      try {
        await setCategoryNature({
          categoryId: category.id,
          nature: category.nature === nature ? null : nature,
        });
      } catch {
        toast.error("Erro ao salvar.");
      }
    });
  }

  function handlePot(value: string) {
    startTransition(async () => {
      try {
        await setCategoryPot({
          categoryId: category.id,
          pot: value === "" ? null : (value as Pot),
        });
      } catch {
        toast.error("Erro ao salvar.");
      }
    });
  }

  return (
    <li className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2">
        <span
          className="size-2.5 rounded-full"
          style={{ backgroundColor: category.color ?? "var(--color-outline)" }}
        />
        <span className="text-sm text-on-surface">{category.name}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-on-surface-variant">
          <span>Pote</span>
          <select
            aria-label={`Pote de ${category.name}`}
            disabled={pending}
            value={category.pot ?? ""}
            onChange={(e) => handlePot(e.target.value)}
            className="min-h-8 rounded-lg border border-input bg-transparent px-2 text-xs text-on-surface disabled:opacity-50"
          >
            <option value="">{potDefaultLabel(category)}</option>
            {POT_ORDER.map((pot) => (
              <option key={pot} value={pot}>
                {POTS[pot].label}
              </option>
            ))}
          </select>
        </label>
        <div
          className="flex gap-1"
          role="group"
          aria-label={`Natureza de ${category.name}`}
        >
          {NATURES.map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={pending}
              aria-pressed={category.nature === option.value}
              onClick={() => handleSelect(option.value)}
              className={cn(
                "rounded-lg border px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50",
                category.nature === option.value
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input text-on-surface-variant hover:bg-surface-container",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </li>
  );
}

/** Rótulo da opção "automático": mostra para onde a categoria vai sem pote escolhido. */
function potDefaultLabel(category: ReviewCategory): string {
  const pot = resolvePot(category.nature, null);
  return pot ? `Automático (${POTS[pot].label})` : "Sem pote";
}
