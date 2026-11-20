"use client";

import { useRef, useState, useTransition, type DragEvent } from "react";
import { FileUp, Loader2, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { FormError } from "@/components/form-error";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { importOfx, type ImportOfxResult } from "@/actions/import-ofx";
import { cn } from "@/lib/utils";

interface AccountOption {
  id: string;
  name: string;
}

/** Dropzone expansível: arraste um `.ofx`, escolha a conta, veja o resultado da deduplicação. */
export function OfxDropzone({ accounts }: { accounts: AccountOption[] }) {
  const [expanded, setExpanded] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [pending, startTransition] = useTransition();
  const [lastResult, setLastResult] = useState<ImportOfxResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function processFile(file: File) {
    setError(null);
    if (!accountId) {
      setError("Selecione a conta de destino antes de importar.");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".ofx")) {
      setError("Envie um arquivo .ofx.");
      return;
    }

    const formData = new FormData();
    formData.set("accountId", accountId);
    formData.set("file", file);

    startTransition(async () => {
      try {
        const result = await importOfx(formData);
        setLastResult(result);
        toast.success(
          `${result.recordsInserted} nova(s) transação(ões) importada(s), ${result.recordsSkipped} já existiam.`,
        );
      } catch (e) {
        setLastResult(null);
        setError(e instanceof Error ? e.message : "Falha ao importar o arquivo OFX.");
      }
    });
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (file) processFile(file);
  }

  return (
    <div className="rounded-2xl border border-outline-variant bg-surface-container-low">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-on-surface"
      >
        <span className="flex items-center gap-2">
          <FileUp className="size-4" />
          Importar extrato (.ofx)
        </span>
        <span className="text-xs text-on-surface-variant">{expanded ? "Recolher" : "Expandir"}</span>
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-outline-variant p-4">
          <div className="max-w-xs space-y-1.5">
            <label className="text-xs font-medium text-on-surface-variant">Conta de destino</label>
            <Select value={accountId} onValueChange={(value) => setAccountId(value as string)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Selecione a conta" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors",
              dragOver ? "border-primary bg-primary/5" : "border-outline-variant hover:border-outline",
            )}
          >
            {pending ? (
              <Loader2 className="size-6 animate-spin text-primary" />
            ) : (
              <UploadCloud className="size-6 text-on-surface-variant" />
            )}
            <p className="text-sm text-on-surface">
              Arraste o arquivo .ofx aqui ou <span className="font-medium text-primary">clique para escolher</span>
            </p>
            <input
              ref={inputRef}
              type="file"
              accept=".ofx"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) processFile(file);
                e.target.value = "";
              }}
            />
          </div>

          <FormError message={error} />

          {lastResult && (
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-lg bg-surface-container-high py-2">
                <p className="font-semibold text-on-surface">{lastResult.recordsProcessed}</p>
                <p className="text-on-surface-variant">Lidos</p>
              </div>
              <div className="rounded-lg bg-income-container py-2">
                <p className="font-semibold text-income-on-container">{lastResult.recordsInserted}</p>
                <p className="text-income-on-container/80">Importados</p>
              </div>
              <div className="rounded-lg bg-surface-container-high py-2">
                <p className="font-semibold text-on-surface">{lastResult.recordsSkipped}</p>
                <p className="text-on-surface-variant">Deduplicados</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
