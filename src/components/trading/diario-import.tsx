"use client";

import { useRef, useState, useTransition } from "react";
import { FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { importDiario } from "@/actions/trading";

const plural = (n: number, one: string, many: string) =>
  `${new Intl.NumberFormat("pt-BR").format(n)} ${n === 1 ? one : many}`;

/** Importa o diario.csv do b3-diario. Reimportar o mesmo arquivo não duplica nada. */
export function DiarioImport({ variant = "outline" }: { variant?: "outline" | "default" }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  function onFile(file: File | undefined) {
    if (!file) return;
    const formData = new FormData();
    formData.set("file", file);
    setStatus("Importando o diário…");
    setError(null);
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof importDiario>>;
      try {
        result = await importDiario(formData);
      } catch {
        if (inputRef.current) inputRef.current.value = "";
        setStatus("");
        setError("Erro ao importar o diário. Tente de novo.");
        return;
      }
      if (inputRef.current) inputRef.current.value = "";
      if (!result.ok) {
        setStatus("");
        setError(result.error);
        return;
      }
      const { inserted, skipped } = result.data;
      const msg =
        inserted === 0
          ? `Nada novo: ${plural(skipped, "operação já estava", "operações já estavam")} no diário.`
          : `${plural(inserted, "operação importada", "operações importadas")}${
              skipped ? `, ${plural(skipped, "já existia", "já existiam")}` : ""
            }.`;
      setStatus(msg);
      toast.success(msg);
    });
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      <Button
        variant={variant}
        size="lg"
        disabled={pending}
        onClick={() => inputRef.current?.click()}
      >
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <FileUp aria-hidden />}
        Importar diario.csv
      </Button>
      <FormError message={error} />
      <span role="status" aria-live="polite" className="sr-only">
        {status}
      </span>
    </>
  );
}
