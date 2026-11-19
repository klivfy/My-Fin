"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { PERIOD_OPTIONS, resolvePeriodRange } from "@/lib/period";

/** Segmented Control de período — grava a seleção em `?period=` (compartilhado por todas as telas). */
export function PeriodSegmentedControl() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = resolvePeriodRange(searchParams.get("period") ?? undefined).key;

  function select(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("period", value);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div
      role="group"
      aria-label="Período"
      className="inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full bg-surface-container-high p-1"
    >
      {PERIOD_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={current === option.value}
          onClick={() => select(option.value)}
          className={cn(
            "min-h-8 shrink-0 rounded-full px-2.5 text-xs font-medium whitespace-nowrap transition-colors duration-150 sm:px-3",
            current === option.value
              ? "bg-surface text-on-surface shadow-sm"
              : "text-on-surface-variant hover:text-on-surface",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
