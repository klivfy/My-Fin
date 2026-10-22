"use client";

import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { runAiCategorizationBatch } from "@/actions/categorization";

/** Teto de lotes por clique: evita um loop longo se algo der errado. */
const MAX_BATCHES = 10;

/**
 * Dispara a categorização por IA lote a lote (uma Server Action por lote)
 * até acabar a fila. Os itens que a IA deixou para revisão manual são
 * pulados nas chamadas seguintes via `skip`.
 */
export function AiCategorizeButton({ enabled, pendingCount }: { enabled: boolean; pendingCount: number }) {
  const [running, startTransition] = useTransition();
  const [progress, setProgress] = useState<string | null>(null);

  function handleClick() {
    startTransition(async () => {
      let skip = 0;
      let categorized = 0;
      let reviewed = 0;

      try {
        for (let i = 0; i < MAX_BATCHES; i += 1) {
          const result = await runAiCategorizationBatch({ skip });
          if (result.status === "missing_credentials") {
            toast.error("Configure ANTHROPIC_API_KEY no servidor para usar a IA.");
            return;
          }
          if (result.status === "failed") {
            toast.error(
              categorized > 0
                ? `A IA falhou após categorizar ${categorized}: ${result.message}`
                : `A IA falhou: ${result.message}`,
            );
            return;
          }
          if (result.processed === 0) break;

          categorized += result.categorized;
          reviewed += result.processed;
          skip += result.processed - result.categorized;
          setProgress(`${reviewed} analisada(s), ${categorized} categorizada(s)…`);
        }

        const leftForReview = reviewed - categorized;
        toast.success(
          leftForReview > 0
            ? `IA categorizou ${categorized}. ${leftForReview} ficou(aram) para revisão manual (confiança baixa).`
            : `IA categorizou ${categorized} transação(ões).`,
        );
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Erro ao categorizar com IA.");
      } finally {
        setProgress(null);
      }
    });
  }

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <Button onClick={handleClick} disabled={!enabled || running || pendingCount === 0} className="gap-2">
        <Sparkles className="size-4" />
        {running ? "Categorizando…" : "Categorizar com IA"}
      </Button>
      {progress && <p className="text-xs text-on-surface-variant">{progress}</p>}
      {!enabled && (
        <p className="text-xs text-on-surface-variant">Defina ANTHROPIC_API_KEY no servidor para habilitar.</p>
      )}
    </div>
  );
}
