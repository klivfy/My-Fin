"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { dismissInsight, restoreInsights } from "@/actions/insights";

/** Dispensa uma sugestão. Some do painel e não volta até "Mostrar de novo". */
export function DismissButton({ id, title }: { id: string; title: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          try {
            const result = await dismissInsight({ id });
            if (!result.ok) toast.error(result.error);
          } catch {
            toast.error("Erro ao dispensar. Tente de novo.");
          }
        })
      }
    >
      Dispensar<span className="sr-only">: {title}</span>
    </Button>
  );
}

export function RestoreButton({ count }: { count: number }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          try {
            const result = await restoreInsights();
            if (!result.ok) toast.error(result.error);
          } catch {
            toast.error("Erro ao restaurar. Tente de novo.");
          }
        })
      }
    >
      Mostrar de novo ({count} dispensada{count === 1 ? "" : "s"})
    </Button>
  );
}
