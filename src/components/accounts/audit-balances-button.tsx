"use client";

import { useState, useTransition } from "react";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { auditAllAccountBalances } from "@/actions/accounts";

/**
 * Botão "Auditar saldos": recalcula o saldo de todas as contas a partir das
 * transações e compara com o materializado, corrigindo desvios. Defesa
 * contra drift silencioso do `currentBalance`.
 */
export function AuditBalancesButton() {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  function run() {
    startTransition(async () => {
      try {
        const results = await auditAllAccountBalances({ fix: true });
        const drifted = results.filter((r) => !r.drift.startsWith("0.00") && r.drift !== "0.00");
        const corrected = results.filter((r) => r.corrected);
        if (drifted.length === 0) {
          toast.success("Todos os saldos conferem com o extrato.");
        } else {
          toast.warning(
            `${corrected.length} conta(s) com divergência corrigida(s): ${drifted
              .map((r) => `desvio de R$ ${r.drift}`)
              .join("; ")}.`,
          );
        }
        setDone(true);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Falha ao auditar saldos.");
      }
    });
  }

  return (
    <Button variant="outline" size="sm" onClick={run} disabled={pending}>
      <ShieldCheck className="size-4" />
      {pending ? "Auditando…" : done ? "Auditar novamente" : "Auditar saldos"}
    </Button>
  );
}
