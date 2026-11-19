import Decimal from "decimal.js";

/**
 * Painel de risco do diário. Espelha os números de `contexto()` do b3-risco
 * (trader-b3/skills/b3-risco/risco.py) para EXIBIR o estado do dia e do mês.
 *
 * Não é a autoridade: quem aprova ou bloqueia uma entrada é o b3-risco, que
 * também soma o risco das posições abertas (o app não vê a carteira). Este
 * módulo nunca bloqueia nada, e saídas nunca são bloqueadas.
 */

export interface RiskTrade {
  date: string; // AAAA-MM-DD (saída)
  entryDate: string | null;
  resultBrl: Decimal | null;
}

export interface RiskLimits {
  maxLossDay: Decimal | null;
  maxLossMonth: Decimal | null;
  pauseDaysAfterMonth: number | null;
  maxTradesDay: number | null;
}

export type LimitState = "unset" | "ok" | "reached";

export interface RiskSnapshot {
  today: string;
  lossesToday: Decimal;
  entriesToday: number;
  monthResult: Decimal;
  monthHitOn: string | null;
  pauseUntil: string | null;
  day: { state: LimitState; room: Decimal | null };
  trades: { state: LimitState; room: number | null };
  month: { state: LimitState; room: Decimal | null };
  pause: { active: boolean };
  /** Alguma regra visível aqui já barra novas entradas no b3-risco. */
  entriesBlocked: boolean;
}

const ZERO = new Decimal(0);
const DEFAULT_PAUSE_DAYS = 7;

export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Data de hoje no fuso da B3 (America/Sao_Paulo), em AAAA-MM-DD. */
export function todayInB3(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function riskSnapshot(trades: RiskTrade[], limits: RiskLimits, today: string): RiskSnapshot {
  const lossesToday = trades
    .filter((t) => t.date === today && t.resultBrl !== null && t.resultBrl.lt(0))
    .reduce((acc, t) => acc.plus(t.resultBrl!.neg()), ZERO);

  const entriesToday = trades.filter((t) => (t.entryDate ?? t.date) === today).length;

  // Acumulado por mês e a data em que cada mês bateu o limite. A pausa conta
  // a partir da batida mais recente, mesmo do mês anterior (atravessa a virada).
  const closed = trades
    .filter((t) => t.resultBrl !== null && t.date <= today)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const byMonth = new Map<string, Decimal>();
  const hit = new Map<string, string>();
  for (const t of closed) {
    const m = t.date.slice(0, 7);
    const acc = (byMonth.get(m) ?? ZERO).plus(t.resultBrl!);
    byMonth.set(m, acc);
    if (limits.maxLossMonth && !hit.has(m) && acc.lte(limits.maxLossMonth.neg())) hit.set(m, t.date);
  }
  const monthResult = byMonth.get(today.slice(0, 7)) ?? ZERO;
  const monthHitOn = hit.size ? [...hit.values()].sort().at(-1)! : null;
  const pauseUntil = monthHitOn
    ? addDays(monthHitOn, limits.pauseDaysAfterMonth ?? DEFAULT_PAUSE_DAYS)
    : null;
  const pauseActive = pauseUntil !== null && today < pauseUntil;

  const day: RiskSnapshot["day"] = limits.maxLossDay
    ? {
        state: lossesToday.gte(limits.maxLossDay) ? "reached" : "ok",
        room: Decimal.max(limits.maxLossDay.minus(lossesToday), ZERO),
      }
    : { state: "unset", room: null };

  const tradesLimit: RiskSnapshot["trades"] =
    limits.maxTradesDay !== null
      ? {
          state: entriesToday >= limits.maxTradesDay ? "reached" : "ok",
          room: Math.max(limits.maxTradesDay - entriesToday, 0),
        }
      : { state: "unset", room: null };

  const month: RiskSnapshot["month"] = limits.maxLossMonth
    ? {
        state: monthResult.lte(limits.maxLossMonth.neg()) ? "reached" : "ok",
        room: Decimal.max(limits.maxLossMonth.plus(monthResult), ZERO),
      }
    : { state: "unset", room: null };

  return {
    today,
    lossesToday,
    entriesToday,
    monthResult,
    monthHitOn,
    pauseUntil,
    day,
    trades: tradesLimit,
    month,
    pause: { active: pauseActive },
    entriesBlocked:
      day.state === "reached" ||
      tradesLimit.state === "reached" ||
      month.state === "reached" ||
      pauseActive,
  };
}

export interface JournalStats {
  closed: number;
  wins: number;
  winRate: number | null;
  net: Decimal;
  costs: Decimal;
  /** Média de R das operações com R registrado. */
  expectancyR: Decimal | null;
}

export function journalStats(
  trades: Array<{ resultBrl: Decimal | null; resultR: Decimal | null; costs: Decimal | null }>,
): JournalStats {
  const closed = trades.filter((t) => t.resultBrl !== null);
  const wins = closed.filter((t) => t.resultBrl!.gt(0)).length;
  const withR = closed.filter((t) => t.resultR !== null);
  return {
    closed: closed.length,
    wins,
    winRate: closed.length ? wins / closed.length : null,
    net: closed.reduce((acc, t) => acc.plus(t.resultBrl!), ZERO),
    costs: trades.reduce((acc, t) => acc.plus(t.costs ?? ZERO), ZERO),
    expectancyR: withR.length
      ? withR.reduce((acc, t) => acc.plus(t.resultR!), ZERO).div(withR.length)
      : null,
  };
}
