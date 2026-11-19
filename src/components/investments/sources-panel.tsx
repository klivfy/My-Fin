"use client";

import { useId, useRef, useState, useTransition } from "react";
import { AlertCircle, Check, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { importB3Negociacao, importBrokerageNote, type ImportResult } from "@/actions/investments";
import { PDF_NEEDS_PASSWORD, PDF_WRONG_PASSWORD } from "@/lib/investments/messages";
import { formatDateShort } from "@/lib/format";
import type { SourcesView } from "@/lib/queries/investments";
import { cn } from "@/lib/utils";

const count = new Intl.NumberFormat("pt-BR");
const plural = (n: number, one: string, many: string) => `${count.format(n)} ${n === 1 ? one : many}`;
const day = (iso: string) => formatDateShort(iso).replace(/\.$/, "");

type Status = { tone: "ok" | "error" | "busy"; text: string } | null;

function summary({ inserted, matched, skipped }: ImportResult): string {
  if (inserted === 0 && matched === 0) {
    return `Nada novo: ${plural(skipped, "negócio já estava", "negócios já estavam")} na carteira.`;
  }
  const parts = [
    inserted && plural(inserted, "negócio importado", "negócios importados"),
    matched && plural(matched, "negócio completado com a nota", "negócios completados com a nota"),
    skipped && plural(skipped, "já existia", "já existiam"),
  ].filter(Boolean);
  return `${parts.join(", ")}.`;
}

/**
 * Fontes de dados da carteira: planilha da B3, notas de corretagem e Open
 * Finance. Cada fonte mostra o próprio estado real, e o resultado da última
 * ação fica escrito na linha (não só num aviso que some).
 */
export function SourcesPanel({ sources }: { sources: SourcesView }) {
  return (
    <section aria-labelledby="fontes" className="rounded-xl border border-outline-variant bg-card">
      <header className="border-b border-outline-variant px-5 py-4">
        <h2 id="fontes" className="text-sm font-medium text-on-surface">
          Fontes de dados
        </h2>
        <p className="mt-1 text-xs text-pretty text-on-surface-variant">
          Arquivos lidos no servidor e descartados em seguida. CPF, conta e código de cliente não são gravados.
        </p>
      </header>
      <ul className="divide-y divide-outline-variant">
        <B3Row b3={sources.b3} />
        <NotesRow notes={sources.notes} withoutNote={sources.tradesWithoutNote} />
        <OpenFinanceRow connections={sources.openFinanceConnections} />
      </ul>
    </section>
  );
}

function Row({
  title,
  help,
  meta,
  children,
}: {
  title: string;
  help: string;
  meta?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <li className="space-y-3 px-5 py-4">
      <div className="space-y-1">
        <h3 className="text-sm font-medium text-on-surface">{title}</h3>
        <p className="text-xs text-pretty text-on-surface-variant">{help}</p>
        {meta && <div className="text-xs text-on-surface-variant tabular-nums">{meta}</div>}
      </div>
      {children}
    </li>
  );
}

function StatusLine({ status }: { status: Status }) {
  return (
    <p
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-start gap-1.5 text-sm text-pretty empty:hidden",
        status?.tone === "error" ? "text-expense" : "text-on-surface",
      )}
    >
      {status?.tone === "error" && <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />}
      {status?.tone === "ok" && <Check className="mt-0.5 size-4 shrink-0 text-income" aria-hidden />}
      {status?.tone === "busy" && <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" aria-hidden />}
      {status?.text}
    </p>
  );
}

function B3Row({ b3 }: { b3: SourcesView["b3"] }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<Status>(null);

  function onFile(file: File | undefined) {
    if (!file) return;
    const formData = new FormData();
    formData.set("file", file);
    setStatus({ tone: "busy", text: "Lendo a planilha…" });
    startTransition(async () => {
      const result = await importB3Negociacao(formData);
      if (inputRef.current) inputRef.current.value = "";
      setStatus(result.ok ? { tone: "ok", text: summary(result.data) } : { tone: "error", text: result.error });
    });
  }

  const meta = b3.lastImportAt
    ? b3.failed
      ? `A última importação, em ${day(b3.lastImportAt)}, falhou.`
      : `Última importação em ${day(b3.lastImportAt)}${
          b3.lastInserted !== null ? `: ${plural(b3.lastInserted, "negócio novo", "negócios novos")}` : ""
        }.`
    : "Nenhuma planilha importada ainda.";

  return (
    <Row
      title="Planilha de negociação da B3"
      help="Área do Investidor, em Extratos > Negociação, exportada em Excel. Traz os negócios de todas as corretoras."
      meta={meta}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      <Button variant="outline" size="lg" disabled={pending} onClick={() => inputRef.current?.click()}>
        <FileSpreadsheet aria-hidden />
        Escolher planilha .xlsx
      </Button>
      <StatusLine status={status} />
    </Row>
  );
}

function NotesRow({ notes, withoutNote }: { notes: SourcesView["notes"]; withoutNote: number }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const passwordId = useId();
  const passwordHelpId = useId();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<Status>(null);
  // O arquivo fica na memória do navegador só enquanto a senha é pedida.
  const [lockedFile, setLockedFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");

  function send(file: File, pwd?: string) {
    const formData = new FormData();
    formData.set("file", file);
    if (pwd) formData.set("password", pwd);
    setStatus({ tone: "busy", text: "Lendo a nota de corretagem…" });
    startTransition(async () => {
      const result = await importBrokerageNote(formData);
      if (inputRef.current) inputRef.current.value = "";
      if (!result.ok && (result.error === PDF_NEEDS_PASSWORD || result.error === PDF_WRONG_PASSWORD)) {
        setLockedFile(file);
        setStatus(result.error === PDF_WRONG_PASSWORD ? { tone: "error", text: result.error } : null);
        return;
      }
      setLockedFile(null);
      setPassword("");
      setStatus(result.ok ? { tone: "ok", text: summary(result.data) } : { tone: "error", text: result.error });
    });
  }

  const parts = [
    notes.count > 0 ? plural(notes.count, "nota importada", "notas importadas") : "Nenhuma nota importada ainda",
    notes.lastTradeDate && `último pregão em ${day(notes.lastTradeDate)}`,
    notes.failed && "a última importação falhou",
  ].filter(Boolean);

  return (
    <Row
      title="Notas de corretagem"
      help="PDF no padrão SINACOR (XP, BTG e a maioria das corretoras). Soma taxas e corretagem ao preço médio."
      meta={
        <>
          <p>{parts.join(", ")}.</p>
          {withoutNote > 0 && (
            <p className="mt-1 text-warning-on-container">
              {plural(withoutNote, "negócio está sem nota", "negócios estão sem nota")}: o custo deles ainda não entra
              no preço médio.
            </p>
          )}
        </>
      }
    >
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,application/pdf"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) send(file);
        }}
      />
      {lockedFile ? (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (password) send(lockedFile, password);
          }}
        >
          <label htmlFor={passwordId} className="block text-sm font-medium text-on-surface">
            Senha do PDF
          </label>
          <Input
            id={passwordId}
            type="password"
            autoComplete="off"
            autoFocus
            required
            aria-describedby={passwordHelpId}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-10 text-base"
          />
          <p id={passwordHelpId} className="text-xs break-words text-on-surface-variant">
            {lockedFile.name} tem senha. Ela é usada só para abrir este arquivo e não é guardada.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="lg" disabled={pending || !password}>
              Abrir nota
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="lg"
              disabled={pending}
              onClick={() => {
                setLockedFile(null);
                setPassword("");
                setStatus(null);
              }}
            >
              Cancelar
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="outline" size="lg" disabled={pending} onClick={() => inputRef.current?.click()}>
          <FileText aria-hidden />
          Escolher nota em PDF
        </Button>
      )}
      <StatusLine status={status} />
    </Row>
  );
}

function OpenFinanceRow({ connections }: { connections: number }) {
  return (
    <Row
      title="Open Finance"
      help={
        connections > 0
          ? `${plural(connections, "conexão ativa", "conexões ativas")}.`
          : "Não conectado. A leitura automática da corretora depende de um cadastro no agregador, que ainda não foi feito. Até lá, use os arquivos acima."
      }
    />
  );
}
