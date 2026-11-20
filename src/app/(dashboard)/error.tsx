"use client";

import { useEffect } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function DashboardError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const digest =
    error && typeof error === "object" && "digest" in error && typeof error.digest === "string" ? error.digest : null;

  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-start gap-3 px-4 py-16">
      <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
        <AlertCircle className="size-5 text-expense" aria-hidden="true" />
        Não foi possível carregar esta tela
      </h1>
      <p className="text-sm text-on-surface-variant">
        Seus dados não foram alterados. Tente de novo; se continuar, confira a conexão com o banco.
      </p>
      {digest && <p className="text-xs text-on-surface-variant">Código do erro: <span className="font-mono">{digest}</span></p>}
      <Button onClick={() => retry()}>Tentar de novo</Button>
    </div>
  );
}
