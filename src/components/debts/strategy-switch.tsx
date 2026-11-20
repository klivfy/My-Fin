"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import type { ChosenStrategy } from "@/lib/queries/debts";

const OPTIONS: Array<{ value: ChosenStrategy; label: string }> = [
  { value: "bola-de-neve", label: "Bola de neve" },
  { value: "avalanche", label: "Avalanche" },
];

/** Método do plano mês a mês. Estado na URL (`?metodo=`), como os outros seletores do app. */
export function StrategySwitch({ current }: { current: ChosenStrategy }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function select(value: ChosenStrategy) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("metodo", value);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <div role="group" aria-label="Método" className="inline-flex rounded-lg border border-outline-variant p-0.5">
      {OPTIONS.map((o) => {
        const active = o.value === current;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => select(o.value)}
            className={cn(
              "min-h-9 rounded-md px-3 text-sm font-medium transition-colors duration-150",
              active ? "bg-secondary text-secondary-foreground" : "text-on-surface-variant hover:text-on-surface",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
