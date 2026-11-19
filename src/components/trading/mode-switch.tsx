"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import type { ModeFilter } from "@/lib/queries/trading";

/** Real e simulado nunca se misturam (regra do b3-risco): a tela mostra um de cada vez. */
export function ModeSwitch({ current, counts }: { current: ModeFilter; counts?: Record<ModeFilter, number> }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function select(mode: ModeFilter) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("modo", mode);
    router.push(`${pathname}?${params.toString()}`);
  }

  const options: Array<{ value: ModeFilter; label: string }> = [
    { value: "real", label: "Real" },
    { value: "simulado", label: "Simulado" },
  ];

  return (
    <div role="group" aria-label="Modo" className="inline-flex rounded-lg border border-outline-variant p-0.5">
      {options.map((o) => {
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
            {counts && <span className="ml-1.5 tabular-nums opacity-80">{counts[o.value]}</span>}
          </button>
        );
      })}
    </div>
  );
}
