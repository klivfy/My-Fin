"use client";

import { useId, useRef, useState, useTransition } from "react";
import { AlertCircle, Check, FileSpreadsheet, FileText, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { importB3Negociacao, importBrokerageNote, type ImportResult } from "@/actions/investments";
import { connectPluggyItem, disconnectPluggy, syncPluggy, type PluggySyncResult } from "@/actions/pluggy";
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
        <OpenFinanceRow openFinance={sources.openFinance} />
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

function pluggySummary(r: PluggySyncResult): string {
  const parts = [summary(r)];
  if (r.ignored > 0) {
    parts.push(
      `${plural(r.ignored, "movimento fora de ações, FIIs e ETFs ficou", "movimentos fora de ações, FIIs e ETFs ficaram")} de fora.`,
    );
  }
  return [...parts, ...r.failures].join(" ");
}

const CONNECTION_STATE: Record<string, { text: string; className: string }> = {
  ACTIVE: { text: "conectada", className: "text-on-surface-variant" },
  EXPIRED: {
    text: "pede login de novo no Pluggy",
    className: "text-warning-on-container",
  },
  ERROR: { text: "a última sincronização falhou", className: "text-expense" },
  REVOKED: { text: "desativada", className: "text-on-surface-variant" },
};

function OpenFinanceRow({
  openFinance,
}: {
  openFinance: SourcesView["openFinance"];
}) {
  const itemId = useId();
  const itemHelpId = useId();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<Status>(null);

  function run(
    busy: string,
    action: () => Promise<
      { ok: true; data: PluggySyncResult } | { ok: false; error: string }
    >,
  ) {
    setStatus({ tone: "busy", text: busy });
    startTransition(async () => {
      const result = await action();
      setStatus(
        result.ok
          ? { tone: "ok", text: pluggySummary(result.data) }
          : { tone: "error", text: result.error },
      );
    });
  }

  if (!openFinance.configured) {
    return (
      <Row
        title="Open Finance"
        help="Não configurado. Grave PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET nas variáveis de ambiente do servidor para ler a corretora pelo Pluggy. Até lá, use os arquivos acima."
      />
    );
  }

  const { connections } = openFinance;
  const lastSync = connections
    .map((c) => c.lastSyncAt)
    .filter((d): d is string => d !== null)
    .sort()
    .at(-1);

  return (
    <Row
      title="Open Finance"
      help="Negócios da corretora lidos pelo Pluggy. Compras e vendas que já vieram da B3 ou das notas não são duplicadas."
      meta={
        connections.length === 0
          ? "Nenhuma conexão cadastrada."
          : lastSync
            ? `Última sincronização em ${day(lastSync)}.`
            : "Ainda não sincronizado."
      }
    >
      {connections.length > 0 && (
        <ul className="space-y-2">
          {connections.map((c) => {
            const state = CONNECTION_STATE[c.status] ?? CONNECTION_STATE.ACTIVE;
            return (
              <li
                key={c.id}
                className="flex items-start justify-between gap-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-on-surface">
                    {c.label}
                  </p>
                  <p className={cn("text-xs", state.className)}>{state.text}</p>
                </div>
                <form
                  action={(fd) =>
                    startTransition(async () => {
                      const result = await disconnectPluggy(fd);
                      setStatus(
                        result.ok
                          ? {
                              tone: "ok",
                              text: `${c.label} desconectada. Os negócios já importados continuam na carteira.`,
                            }
                          : { tone: "error", text: result.error },
                      );
                    })
                  }
                >
                  <input type="hidden" name="id" value={c.id} />
                  <Button
                    type="submit"
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    aria-label={`Desconectar ${c.label}`}
                  >
                    Desconectar
                  </Button>
                </form>
              </li>
            );
          })}
        </ul>
      )}

      {connections.length > 0 ? (
        <Button
          variant="outline"
          size="lg"
          disabled={pending}
          onClick={() => run("Sincronizando com o Pluggy…", syncPluggy)}
        >
          <RefreshCw aria-hidden />
          Sincronizar agora
        </Button>
      ) : (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            run("Conectando e lendo os negócios…", () => connectPluggyItem(fd));
          }}
        >
          <label
            htmlFor={itemId}
            className="block text-sm font-medium text-on-surface"
          >
            Id do item no Pluggy
          </label>
          <Input
            id={itemId}
            name="itemId"
            required
            autoComplete="off"
            spellCheck={false}
            pattern="[0-9a-fA-F\-]{36}"
            aria-describedby={itemHelpId}
            placeholder="00000000-0000-0000-0000-000000000000"
            className="h-10 font-mono text-sm"
          />
          <p
            id={itemHelpId}
            className="text-xs text-pretty text-on-surface-variant"
          >
            Crie a conexão com a corretora no Pluggy e cole aqui o id do item.
            Ele é guardado cifrado; login e senha da corretora ficam só no
            Pluggy.
          </p>
          <Button type="submit" size="lg" disabled={pending}>
            Conectar e sincronizar
          </Button>
        </form>
      )}
      <StatusLine status={status} />
    </Row>
  );
}
