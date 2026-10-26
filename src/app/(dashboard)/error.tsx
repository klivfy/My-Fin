"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * Boundary de erro do dashboard: uma falha de query/render em uma rota não
 * derruba o shell inteiro — o usuário vê uma mensagem amigável e pode
 * tentar de novo sem recarregar a aplicação.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[dashboard] erro de renderização:", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-on-surface">Algo deu errado</h2>
        <p className="max-w-md text-sm text-on-surface-variant">
          Não foi possível carregar esta tela. Seus dados estão seguros — tente novamente.
        </p>
      </div>
      <Button onClick={reset} variant="outline">
        Tentar novamente
      </Button>
    </div>
  );
}
