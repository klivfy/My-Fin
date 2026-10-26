"use client";

import { useRef, useState, useTransition, type DragEvent } from "react";
import { FileSpreadsheet, Loader2, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { importCsv } from "@/actions/import-csv";
import { cn } from "@/lib/utils";

interface AccountOption {
  id: string;
  name: string;
}

const DATE_FORMATS = [
  { value: "dd/mm/yyyy", label: "dd/mm/aaaa (BR)" },
  { value: "yyyy-mm-dd", label: "aaaa-mm-dd (ISO)" },
  { value: "mm/dd/yyyy", label: "mm/dd/aaaa (US)" },
] as const;

const AMOUNT_FORMATS = [
  { value: "br", label: "1.234,56 (BR)" },
  { value: "intl", label: "1,234.56 (intl)" },
] as const;

/**
 * Dropzone de CSV genérico: o usuário informa os índices das colunas
 * (0-based) de data, descrição e valor — ou de crédito/débito separados —
 * além dos formatos. A autoridade de validação é o servidor.
 */
export function CsvImportPanel({ accounts }: { accounts: AccountOption[] }) {
  const [expanded, setExpanded] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [dateCol, setDateCol] = useState("0");
  const [descCol, setDescCol] = useState("1");
  const [amountCol, setAmountCol] = useState("2");
  const [dateFormat, setDateFormat] = useState<string>("dd/mm/yyyy");
  const [amountFormat, setAmountFormat] = useState<string>("br");
  const [hasHeader, setHasHeader] = useState(true);

  function processFile(file: File) {
    if (!accountId) {
      toast.error("Selecione a conta de destino antes de importar.");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".csv")) {
      toast.error("Envie um arquivo .csv.");
      return;
    }

    const mapping = {
      date: Number(dateCol),
      description: Number(descCol),
      amount: Number(amountCol),
      dateFormat,
      amountFormat,
      hasHeader,
    };

    const formData = new FormData();
    formData.set("accountId", accountId);
    formData.set("mapping", JSON.stringify(mapping));
    formData.set("file", file);

    startTransition(async () => {
      try {
        const result = await importCsv(formData);
        toast.success(
          `${result.recordsInserted} nova(s) transação(ões) importada(s), ${result.recordsSkipped} já existiam.`,
        );
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Falha ao importar o CSV.");
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
          <FileSpreadsheet className="size-4" />
          Importar CSV (mapeamento de colunas)
        </span>
        <span className="text-xs text-on-surface-variant">{expanded ? "Recolher" : "Expandir"}</span>
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-outline-variant p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs">Conta de destino</Label>
              <Select value={accountId} onValueChange={(v) => setAccountId(v as string)}>
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
            <div className="space-y-1.5">
              <Label className="text-xs">Formato da data</Label>
              <Select value={dateFormat} onValueChange={(v) => setDateFormat(v as string)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DATE_FORMATS.map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Formato do valor</Label>
              <Select value={amountFormat} onValueChange={(v) => setAmountFormat(v as string)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AMOUNT_FORMATS.map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Coluna data", value: dateCol, setter: setDateCol },
              { label: "Coluna descrição", value: descCol, setter: setDescCol },
              { label: "Coluna valor", value: amountCol, setter: setAmountCol },
            ].map((field) => (
              <div key={field.label} className="space-y-1.5">
                <Label className="text-xs">{field.label} (índice 0-based)</Label>
                <input
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  inputMode="numeric"
                  value={field.value}
                  onChange={(e) => field.setter(e.target.value)}
                />
              </div>
            ))}
          </div>

          <label className="flex items-center gap-2 text-xs text-on-surface-variant">
            <input
              type="checkbox"
              checked={hasHeader}
              onChange={(e) => setHasHeader(e.target.checked)}
              className="size-4"
            />
            Primeira linha é cabeçalho
          </label>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors",
              dragOver ? "border-primary bg-primary/5" : "border-outline-variant hover:border-outline",
            )}
          >
            {pending ? (
              <Loader2 className="size-6 animate-spin text-primary" />
            ) : (
              <UploadCloud className="size-6 text-on-surface-variant" />
            )}
            <p className="text-sm text-on-surface">
              Arraste o arquivo .csv aqui ou <span className="font-medium text-primary">clique para escolher</span>
            </p>
            <input
              ref={inputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) processFile(file);
                e.target.value = "";
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
