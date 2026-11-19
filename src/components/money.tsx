import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";

type MoneyTone = "income" | "expense" | "transfer" | "neutral" | "auto";

const TONE_CLASS: Record<Exclude<MoneyTone, "auto">, string> = {
  income: "text-income",
  expense: "text-expense",
  transfer: "text-transfer",
  neutral: "text-foreground",
};

/**
 * Renderiza um valor monetário com tipografia tabular (`tabular-nums`,
 * obrigatória para qualquer número financeiro nesta aplicação), sinal
 * explícito (`+`/`-`) e acento de cor por natureza do lançamento —
 * respeitando o Modo Privacidade via CSS (`data-privacy="on"` em um
 * ancestral, ver globals.css e `privacy-mode.tsx`).
 */
export function Money({
  value,
  tone = "auto",
  showSign = true,
  className,
}: {
  value: number | string;
  tone?: MoneyTone;
  showSign?: boolean;
  className?: string;
}) {
  const numeric = typeof value === "string" ? Number(value) : value;
  const resolvedTone: Exclude<MoneyTone, "auto"> =
    tone !== "auto" ? tone : numeric > 0 ? "income" : numeric < 0 ? "expense" : "neutral";
  const prefix = showSign && numeric > 0 ? "+" : "";

  return (
    <span
      className={cn("money-value tabular-nums font-semibold whitespace-nowrap", TONE_CLASS[resolvedTone], className)}
    >
      {prefix}
      {formatBRL(numeric)}
    </span>
  );
}
