"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { setCategoryNature } from "@/actions/categorization";
import type { ReviewCategory } from "@/lib/queries/categorization";

const NATURES = [
  { value: "NEED", label: "Necessidade" },
  { value: "WANT", label: "Desejo" },
  { value: "SAVINGS", label: "Poupança" },
] as const;

/** Marca cada categoria de despesa como Necessidade, Desejo ou Poupança (50/30/20). */
export function CategoryNatureList({ categories }: { categories: ReviewCategory[] }) {
  const expenseCategories = categories.filter((category) => category.type === "EXPENSE");

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
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Erro ao salvar.");
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
      <div className="flex gap-1" role="group" aria-label={`Natureza de ${category.name}`}>
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
                : "border-input text-muted-foreground hover:bg-accent",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </li>
  );
}
