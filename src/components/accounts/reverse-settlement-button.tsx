"use client";

import { useTransition } from "react";
import { Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { reverseInvoiceSettlement } from "@/actions/credit-cards";

/** Botão de estorno de liquidação de fatura (reabre a fatura e devolve o dinheiro à conta pagadora). */
export function ReverseSettlementButton({ invoiceId }: { invoiceId: string }) {
  const [pending, startTransition] = useTransition();

  function handleReverse() {
    if (!confirm("Estornar o pagamento desta fatura? O valor retorna à conta pagadora e a fatura reabre.")) {
      return;
    }
    startTransition(async () => {
      try {
        await reverseInvoiceSettlement({ invoiceId });
        toast.success("Pagamento estornado; fatura reaberta.");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Erro ao estornar.");
      }
    });
  }

  return (
    <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={handleReverse} disabled={pending}>
      <Undo2 className="size-3.5" /> Estornar
    </Button>
  );
}
