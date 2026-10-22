"use client";

import { useTransition } from "react";
import { EyeOff, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ignoreRecurrence, restoreRecurrence } from "@/actions/recurring";

/** "Não é recorrente": some do calendário e da lista de assinaturas. */
export function IgnoreRecurrenceButton({ recurrenceKey, name }: { recurrenceKey: string; name: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="icon"
      variant="ghost"
      disabled={pending}
      aria-label={`Não é recorrente: ${name}`}
      title="Não é recorrente"
      onClick={() =>
        startTransition(async () => {
          try {
            await ignoreRecurrence({ key: recurrenceKey });
            toast.success(`"${name}" não será mais tratado como recorrente.`);
          } catch {
            toast.error("Erro ao salvar.");
          }
        })
      }
    >
      <EyeOff className="size-4" />
    </Button>
  );
}

export function RestoreRecurrenceButton({ recurrenceKey }: { recurrenceKey: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      className="gap-1"
      onClick={() =>
        startTransition(async () => {
          try {
            await restoreRecurrence({ key: recurrenceKey });
          } catch {
            toast.error("Erro ao restaurar.");
          }
        })
      }
    >
      <RotateCcw className="size-3.5" />
      Restaurar
    </Button>
  );
}
