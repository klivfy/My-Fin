import { CalendarClock, Repeat } from "lucide-react";
import { getRecurringData, type CalendarItem, type RecurringItem } from "@/lib/queries/recurring";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/dashboard/empty-state";
import { IgnoreRecurrenceButton, RestoreRecurrenceButton } from "@/components/recurring/recurrence-actions";
import { formatBRL, formatDateShort } from "@/lib/format";
import { cn } from "@/lib/utils";

const STATUS: Record<CalendarItem["status"], { label: string; className: string }> = {
  PAID: { label: "Pago", className: "bg-income-container text-income-on-container" },
  UPCOMING: { label: "A vencer", className: "bg-surface-container-highest text-on-surface-variant" },
  OVERDUE: { label: "Atrasado?", className: "bg-expense-container text-expense-on-container" },
};

const CONFIDENCE: Record<RecurringItem["confidence"], { label: string; title: string }> = {
  HIGH: { label: "A", title: "Confiança alta: 3+ meses seguidos, mesmo valor e mesmo dia" },
  MEDIUM: { label: "M", title: "Confiança média: padrão claro, mas valor ou dia variam" },
  LOW: { label: "B", title: "Confiança baixa: confira se é mesmo recorrente" },
};

function ConfidenceChip({ confidence }: { confidence: RecurringItem["confidence"] }) {
  const config = CONFIDENCE[confidence];
  return (
    <span
      title={config.title}
      aria-label={config.title}
      className="inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-outline-variant text-[10px] font-semibold text-on-surface-variant"
    >
      {config.label}
    </span>
  );
}

export default async function RecurringPage() {
  const { monthLabel, calendar, subscriptions, possible, inactive, ignored } = await getRecurringData();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-on-surface">Contas e assinaturas</h1>
        <p className="text-sm text-on-surface-variant">
          Cobranças recorrentes detectadas nos últimos 13 meses de despesas.
        </p>
      </div>

      <Card>
        <CardHeader className="space-y-1">
          <CardTitle className="text-sm font-medium">Calendário de contas · {monthLabel}</CardTitle>
          {calendar.entries.length > 0 && (
            <p className="text-xs text-on-surface-variant">
              {formatBRL(calendar.total)} no mês · {formatBRL(calendar.paid)} pago ·{" "}
              <span className="font-medium text-on-surface">{formatBRL(calendar.pending)} a pagar</span>
            </p>
          )}
        </CardHeader>
        <CardContent>
          {calendar.entries.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title="Nenhuma conta recorrente detectada"
              description="Importe ao menos 2 ou 3 meses de extrato para o app reconhecer as cobranças que se repetem."
            />
          ) : (
            <ul className="divide-y divide-outline-variant">
              {calendar.entries.map((entry) => (
                <li key={entry.key} className="flex items-center gap-3 py-2.5">
                  <div className="w-12 shrink-0 text-center">
                    <p className="text-lg font-semibold leading-none text-on-surface tabular-nums">
                      {new Date(entry.expectedDate).getUTCDate()}
                    </p>
                    <p className="text-[10px] text-on-surface-variant">
                      {entry.cadence === "ANNUAL" ? "anual" : "todo mês"}
                    </p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-sm text-on-surface">
                      <span className="truncate" title={entry.name}>
                        {entry.name}
                      </span>
                      <ConfidenceChip confidence={entry.confidence} />
                    </p>
                    <p className="text-xs text-on-surface-variant">
                      {entry.kind === "SUBSCRIPTION" ? "Assinatura" : "Conta"}
                      {entry.categoryName && ` · ${entry.categoryName}`}
                      {entry.paidDate && ` · paga em ${formatDateShort(entry.paidDate)}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-sm tabular-nums text-on-surface">
                      {entry.status === "PAID" ? "" : "~"}
                      {formatBRL(entry.amount)}
                    </span>
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", STATUS[entry.status].className)}>
                      {STATUS[entry.status].label}
                    </span>
                  </div>
                  <IgnoreRecurrenceButton recurrenceKey={entry.key} name={entry.name} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="space-y-1">
          <CardTitle className="text-sm font-medium">Assinaturas ativas</CardTitle>
          {subscriptions.items.length > 0 && (
            <p className="text-xs text-on-surface-variant">
              {formatBRL(subscriptions.monthlyTotal)}/mês ·{" "}
              <span className="font-medium text-on-surface">{formatBRL(subscriptions.annualTotal)} por ano</span>. Vale
              a pena manter todas?
            </p>
          )}
        </CardHeader>
        <CardContent>
          {subscriptions.items.length === 0 ? (
            <EmptyState
              icon={Repeat}
              title="Nenhuma assinatura detectada"
              description="Assinaturas são cobranças de valor fixo que se repetem e não estão em categorias de Necessidade."
            />
          ) : (
            <ul className="divide-y divide-outline-variant">
              {subscriptions.items.map((item) => (
                <li key={item.key} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-sm text-on-surface">
                      <span className="truncate" title={item.name}>
                        {item.name}
                      </span>
                      <ConfidenceChip confidence={item.confidence} />
                    </p>
                    <p className="text-xs text-on-surface-variant">
                      {item.cadence === "ANNUAL" ? "Anual" : `Todo dia ${item.dayOfMonth}`} · {item.occurrences}{" "}
                      cobrança(s) · última em {formatDateShort(item.lastDate)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-medium tabular-nums text-on-surface">{formatBRL(item.annualCost)}/ano</p>
                    <p className="text-xs tabular-nums text-on-surface-variant">{formatBRL(item.monthlyCost)}/mês</p>
                  </div>
                  <IgnoreRecurrenceButton recurrenceKey={item.key} name={item.name} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {possible.length > 0 && (
        <Card>
          <CardHeader className="space-y-1">
            <CardTitle className="text-sm font-medium">Possíveis recorrências — confira</CardTitle>
            <p className="text-xs text-on-surface-variant">
              Aparecem todo mês, mas o valor varia e o histórico ainda é curto ou as datas são irregulares. Ficam fora
              do calendário até o padrão se confirmar — descarte se não forem contas.
            </p>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-outline-variant">
              {possible.map((item) => (
                <li key={item.key} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-on-surface" title={item.name}>
                      {item.name}
                    </p>
                    <p className="text-xs text-on-surface-variant">
                      {item.occurrences} cobrança(s) · última em {formatDateShort(item.lastDate)}
                      {item.categoryName && ` · ${item.categoryName}`}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm tabular-nums text-on-surface-variant">
                    ~{formatBRL(item.expectedAmount)}
                  </span>
                  <IgnoreRecurrenceButton recurrenceKey={item.key} name={item.name} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {(inactive.length > 0 || ignored.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Paradas e descartadas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {inactive.length > 0 && (
              <ul className="space-y-1">
                {inactive.map((item) => (
                  <li key={item.key} className="flex items-center justify-between gap-2 text-xs text-on-surface-variant">
                    <span className="truncate">
                      {item.name} — sem cobrança desde {formatDateShort(item.lastDate)} (cancelada?)
                    </span>
                    <span className="tabular-nums">{formatBRL(item.expectedAmount)}</span>
                  </li>
                ))}
              </ul>
            )}
            {ignored.length > 0 && (
              <ul className="space-y-1">
                {ignored.map((key) => (
                  <li key={key} className="flex items-center justify-between gap-2 text-xs text-on-surface-variant">
                    <span className="truncate font-mono">{key}</span>
                    <RestoreRecurrenceButton recurrenceKey={key} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-on-surface-variant">
        A = confiança alta, M = média, B = baixa. Valores com “~” são estimativas (média das últimas cobranças).
      </p>
    </div>
  );
}
