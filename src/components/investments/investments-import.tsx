"use client";

import { useId, useRef, useState, useTransition } from "react";
import { FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { importB3Negociacao, importBrokerageNote, type ImportResult } from "@/actions/investments";
import type { ActionResult } from "@/lib/action-result";

const plural = (n: number, one: string, many: string) =>
  `${new Intl.NumberFormat("pt-BR").format(n)} ${n === 1 ? one : many}`;

function summary({ inserted, matched, skipped }: ImportResult): string {
  if (inserted === 0 && matched === 0) {
    return `Nada novo: ${plural(skipped, "negócio já estava", "negócios já estavam")} na carteira.`;
  }
  const parts = [
    inserted && plural(inserted, "negócio importado", "negócios importados"),
    matched && plural(matched, "negócio conciliado", "negócios conciliados"),
    skipped && plural(skipped, "já existia", "já existiam"),
  ].filter(Boolean);
  return `${parts.join(", ")}.`;
}

/**
 * Importa a planilha de negociação da B3 (.xlsx) e notas de corretagem (PDF).
 * Os arquivos são lidos no servidor e descartados; nada pessoal é gravado.
 */
export function InvestmentsImport() {
  const xlsxRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const passwordId = useId();
  const [password, setPassword] = useState("");
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"xlsx" | "pdf" | null>(null);
  const [status, setStatus] = useState("");

  function run(kind: "xlsx" | "pdf", file: File | undefined) {
    if (!file) return;
    const formData = new FormData();
    formData.set("file", file);
    if (kind === "pdf" && password) formData.set("password", password);
    setBusy(kind);
    setStatus(kind === "xlsx" ? "Importando a planilha da B3…" : "Lendo a nota de corretagem…");
    startTransition(async () => {
      const result: ActionResult<ImportResult> =
        kind === "xlsx" ? await importB3Negociacao(formData) : await importBrokerageNote(formData);
      for (const ref of [xlsxRef, pdfRef]) if (ref.current) ref.current.value = "";
      setBusy(null);
      if (!result.ok) {
        setStatus(result.error);
        toast.error(result.error);
        return;
      }
      setPassword("");
      const msg = summary(result.data);
      setStatus(msg);
      toast.success(msg);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={xlsxRef}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => run("xlsx", e.target.files?.[0])}
      />
      <input
        ref={pdfRef}
        type="file"
        accept=".pdf,application/pdf"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => run("pdf", e.target.files?.[0])}
      />
      <Button variant="outline" size="lg" disabled={pending} onClick={() => xlsxRef.current?.click()}>
        {busy === "xlsx" ? <Loader2 className="animate-spin" aria-hidden /> : <FileSpreadsheet aria-hidden />}
        Planilha da B3
      </Button>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={passwordId} className="sr-only">
          Senha do PDF da nota, se houver
        </label>
        <Input
          id={passwordId}
          type="password"
          autoComplete="off"
          placeholder="Senha do PDF"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="h-9 w-40"
        />
        <Button variant="outline" size="lg" disabled={pending} onClick={() => pdfRef.current?.click()}>
          {busy === "pdf" ? <Loader2 className="animate-spin" aria-hidden /> : <FileText aria-hidden />}
          Nota de corretagem
        </Button>
      </div>
      <span role="status" aria-live="polite" className="sr-only">
        {status}
      </span>
    </div>
  );
}
