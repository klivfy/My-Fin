"use client";

import { useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { Download, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { applyCategoryRules } from "@/actions/categories";
import { exportFullBackup, exportTransactionsCsv } from "@/actions/export";

function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Barra de produtividade do extrato: aplicar regras de categorização e exportar dados. */
export function TransactionsToolbar() {
  const [pending, startTransition] = useTransition();
  const searchParams = useSearchParams();

  function handleApplyRules() {
    startTransition(async () => {
      try {
        const result = await applyCategoryRules({});
        toast.success(
          result.matched > 0
            ? `${result.matched} transação(ões) categorizada(s) pelas regras.`
            : "Nenhuma transação correspondeu às regras.",
        );
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Erro ao aplicar regras.");
      }
    });
  }

  function handleExportCsv() {
    startTransition(async () => {
      try {
        const csv = await exportTransactionsCsv({
          accountId: searchParams.get("accountId") ?? undefined,
          categoryId: searchParams.get("categoryId") ?? undefined,
          type: (searchParams.get("type") ?? undefined) as
            | "INCOME"
            | "EXPENSE"
            | "TRANSFER"
            | "ADJUSTMENT"
            | undefined,
          search: searchParams.get("search") ?? undefined,
        });
        downloadFile(`extrato-${new Date().toISOString().slice(0, 10)}.csv`, csv, "text/csv");
        toast.success("Extrato exportado.");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Erro ao exportar.");
      }
    });
  }

  function handleBackup() {
    startTransition(async () => {
      try {
        const dump = await exportFullBackup();
        downloadFile(
          `myfin-backup-${new Date().toISOString().slice(0, 10)}.json`,
          dump,
          "application/json",
        );
        toast.success("Backup completo exportado.");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Erro ao exportar backup.");
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" onClick={handleApplyRules} disabled={pending} className="gap-1.5">
        <Wand2 className="size-3.5" /> Aplicar regras
      </Button>
      <Button variant="outline" size="sm" onClick={handleExportCsv} disabled={pending} className="gap-1.5">
        <Download className="size-3.5" /> Exportar CSV
      </Button>
      <Button variant="outline" size="sm" onClick={handleBackup} disabled={pending} className="gap-1.5">
        <Download className="size-3.5" /> Backup JSON
      </Button>
    </div>
  );
}
