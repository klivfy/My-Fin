import { CircleAlert, CircleCheck, CircleDashed } from "lucide-react";
import { formatBRL, formatDateLong, formatDateShort } from "@/lib/format";
import { getRisk, resolveMode } from "@/lib/queries/trading";
import type { LimitState } from "@/lib/trading/risk";
import { ModeSwitch } from "@/components/trading/mode-switch";
import { LimitsForm } from "@/components/trading/limits-form";
import { cn } from "@/lib/utils";

export default async function TradingRiskPage({ searchParams }: { searchParams: Promise<{ modo?: string }> }) {
  const { modo } = await searchParams;
  const mode = resolveMode(modo);
  const { snapshot: s, limits } = await getRisk(mode);
  const anySet = s.day.state !== "unset" || s.month.state !== "unset" || s.trades.state !== "unset";
  const modeLabel = mode === "real" ? "real" : "simulado";

  const reasons: string[] = [];
  if (s.day.state === "reached") reasons.push("a perda do dia chegou ao limite");
  if (s.trades.state === "reached") reasons.push("o número de entradas do dia chegou ao máximo");
  if (s.month.state === "reached") reasons.push("a perda do mês chegou ao limite");
  if (s.pause.active && s.pauseUntil)
    reasons.push(`há pausa até ${formatDateShort(s.pauseUntil)} porque o limite mensal foi batido em ${formatDateShort(s.monthHitOn!)}`);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-on-surface">Risco de hoje</h1>
          <p className="text-sm text-on-surface-variant">
            {formatDateLong(s.today)} · modo {modeLabel}
          </p>
        </div>
        <ModeSwitch current={mode} />
      </div>

      <section
        aria-live="polite"
        className={cn(
          "flex gap-3 rounded-xl p-4",
          s.entriesBlocked
            ? "bg-expense-container text-expense-on-container"
            : anySet
              ? "bg-surface-container text-on-surface"
              : "bg-warning-container text-warning-on-container",
        )}
      >
        {s.entriesBlocked ? (
          <CircleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
        ) : anySet ? (
          <CircleCheck className="mt-0.5 size-5 shrink-0 text-income" aria-hidden />
        ) : (
          <CircleDashed className="mt-0.5 size-5 shrink-0" aria-hidden />
        )}
        <div className="space-y-1">
          <p className="font-semibold">
            {s.entriesBlocked
              ? "Novas entradas bloqueadas"
              : anySet
                ? "Dentro dos limites pelo diário"
                : "Limites não configurados"}
          </p>
          <p className="text-sm">
            {s.entriesBlocked
              ? `O b3-risco recusa novas entradas: ${reasons.join("; ")}.`
              : anySet
                ? "Nenhum limite visível aqui foi atingido. O b3-risco ainda soma o risco das posições abertas antes de aprovar."
                : "Preencha os limites abaixo com os números do seu config.json para acompanhar o dia."}{" "}
            Saídas nunca são bloqueadas.
          </p>
        </div>
      </section>

      <section aria-labelledby="limites" className="rounded-xl border border-outline-variant bg-surface-container-lowest">
        <h2 id="limites" className="border-b border-outline-variant px-5 py-3 text-sm font-medium text-on-surface">
          Limites do perfil
        </h2>
        <ul className="divide-y divide-outline-variant">
          <LimitRow
            label="Perda realizada no dia"
            used={s.lossesToday.toNumber()}
            limit={limits.maxLossDay}
            state={s.day.state}
            format={formatBRL}
            room={s.day.room ? `folga de ${formatBRL(s.day.room.toNumber())}` : null}
          />
          <LimitRow
            label="Entradas hoje"
            used={s.entriesToday}
            limit={limits.maxTradesDay}
            state={s.trades.state}
            format={(n) => new Intl.NumberFormat("pt-BR").format(n)}
            room={s.trades.room !== null ? `${s.trades.room === 1 ? "resta 1" : `restam ${s.trades.room}`}` : null}
          />
          <LimitRow
            label="Perda no mês"
            used={Math.max(-s.monthResult.toNumber(), 0)}
            limit={limits.maxLossMonth}
            state={s.month.state}
            format={formatBRL}
            room={s.month.room ? `folga de ${formatBRL(s.month.room.toNumber())}` : null}
            note={`resultado do mês: ${formatBRL(s.monthResult.toNumber())}`}
          />
          <li className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-4">
            <span className="text-sm text-on-surface">Pausa após o limite mensal</span>
            <span className={cn("text-sm tabular-nums", s.pause.active ? "font-semibold text-expense" : "text-on-surface-variant")}>
              {s.pause.active && s.pauseUntil ? `ativa até ${formatDateShort(s.pauseUntil)}` : "sem pausa"}
            </span>
          </li>
        </ul>
      </section>

      <section aria-labelledby="config" className="space-y-3">
        <div>
          <h2 id="config" className="text-sm font-medium text-on-surface">
            Configurar limites
          </h2>
          <p className="max-w-prose text-sm text-on-surface-variant">
            Ficam só no banco do app e servem para este painel. A regra que vale é a do config.json do trader-b3.
          </p>
        </div>
        <LimitsForm key={JSON.stringify(limits)} limits={limits} />
      </section>
    </div>
  );
}

function LimitRow({
  label,
  used,
  limit,
  state,
  format,
  room,
  note,
}: {
  label: string;
  used: number;
  limit: number | null;
  state: LimitState;
  format: (n: number) => string;
  room: string | null;
  note?: string;
}) {
  const pct = limit ? Math.min(used / limit, 1) : 0;
  return (
    <li className="space-y-2 px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm text-on-surface">{label}</span>
        <span className="text-sm tabular-nums">
          <span className={cn("font-semibold", state === "reached" ? "text-expense" : "text-on-surface")}>
            {format(used)}
          </span>
          <span className="text-on-surface-variant"> de {limit === null ? "sem limite" : format(limit)}</span>
        </span>
      </div>
      {limit !== null && (
        <div
          role="meter"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-valuenow={Math.min(used, limit)}
          aria-valuetext={`${format(used)} de ${format(limit)}`}
          className="h-1.5 overflow-hidden rounded-full bg-surface-container-highest"
        >
          <div
            className={cn("h-full rounded-full", state === "reached" ? "bg-expense" : "bg-primary")}
            style={{ width: `${pct * 100}%` }}
          />
        </div>
      )}
      {(room || note) && (
        <p className="text-xs text-on-surface-variant">
          {state === "reached" ? "limite atingido" : room}
          {note && (room || state === "reached") ? " · " : ""}
          {note}
        </p>
      )}
    </li>
  );
}
