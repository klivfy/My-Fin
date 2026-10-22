import Decimal from "decimal.js";

/**
 * Detecção de cobranças recorrentes (contas e assinaturas) a partir do
 * histórico de despesas, e o calendário de contas do mês.
 *
 * A detecção mensal olha MESES DE CALENDÁRIO, não o intervalo entre datas:
 * uma conta de luz paga no dia 2 de um mês e no dia 27 do seguinte é tão
 * mensal quanto uma assinatura cobrada sempre no dia 10. A regularidade do
 * dia e do valor só aumentam a confiança.
 */

export interface RecurrenceTx {
  date: Date;
  /** Despesa: negativo. */
  amount: Decimal;
  description: string;
  categoryId: string | null;
  categoryNature: "NEED" | "WANT" | "SAVINGS" | null;
  /** Parcelas não são recorrência: já têm módulo próprio (cartão). */
  isInstallment: boolean;
}

export type Cadence = "MONTHLY" | "ANNUAL";
export type Confidence = "HIGH" | "MEDIUM" | "LOW";
export type RecurrenceKind = "SUBSCRIPTION" | "BILL";

export interface Occurrence {
  date: Date;
  /** Positivo. */
  amount: Decimal;
}

export interface Recurrence {
  key: string;
  name: string;
  cadence: Cadence;
  kind: RecurrenceKind;
  confidence: Confidence;
  categoryId: string | null;
  /** Dia do mês típico (mediana). */
  dayOfMonth: number;
  /** Estimativa da próxima cobrança: média das últimas 3. */
  expectedAmount: Decimal;
  monthlyCost: Decimal;
  annualCost: Decimal;
  lastDate: Date;
  nextDate: Date;
  /** Ainda ativa: cobrada no mês corrente ou no anterior (mensal), ou próxima data no futuro (anual). */
  isActive: boolean;
  occurrences: Occurrence[];
}

/** Variação de valor até a qual consideramos o preço "fixo". */
const FIXED_AMOUNT_TOLERANCE = 0.05;
/** Desvio de dias do mês até o qual consideramos a data "regular". */
const REGULAR_DAY_TOLERANCE = 3;
/** Dias de tolerância após a data prevista antes de marcar como atrasada. */
export const OVERDUE_GRACE_DAYS = 3;

const INSTALLMENT_PATTERN = /\bPARC(ELA)?\b\s*\d+\s*\/\s*\d+/;

/**
 * Chave do "estabelecimento": a descrição normalizada sem números, sem
 * pontuação e sem marcadores de parcela — `NETFLIX.COM 8812` e
 * `NETFLIX.COM 9921` viram o mesmo `NETFLIX COM`.
 */
export function merchantKey(description: string): string {
  return description
    .toUpperCase()
    .replace(INSTALLMENT_PATTERN, " ")
    .replace(/[^A-Z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function monthIndex(date: Date): number {
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function average(values: Decimal[]): Decimal {
  return values.reduce((sum, v) => sum.plus(v), new Decimal(0)).dividedBy(values.length).toDecimalPlaces(2);
}

/** (máx − mín) / média dos valores. */
function amountVariation(values: Decimal[]): number {
  const avg = average(values);
  if (avg.isZero()) return 0;
  const max = Decimal.max(...values);
  const min = Decimal.min(...values);
  return max.minus(min).dividedBy(avg).toNumber();
}

function mostCommon<T>(values: T[]): T {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/** Data prevista no mês `month` (0-based) para um dia típico, sem estourar meses curtos. */
export function expectedDateInMonth(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, Math.min(day, daysInMonth(year, month))));
}

function classifyMonthly(occurrences: Occurrence[]): { confidence: Confidence; months: number } | null {
  const perMonth = new Map<number, number>();
  for (const o of occurrences) perMonth.set(monthIndex(o.date), (perMonth.get(monthIndex(o.date)) ?? 0) + 1);

  const months = [...perMonth.keys()].sort((a, b) => a - b);
  if (months.length < 2) return null;

  // Mais de ~1 cobrança por mês = gasto frequente (mercado, delivery), não conta mensal.
  const monthsWithSingle = [...perMonth.values()].filter((count) => count === 1).length;
  if (monthsWithSingle / months.length < 0.8) return null;

  const span = months[months.length - 1] - months[0] + 1;
  const coverage = months.length / span;
  if (coverage < 0.75) return null;

  const days = occurrences.map((o) => o.date.getUTCDate());
  const typicalDay = median(days);
  const dayRegular = days.every((d) => Math.abs(d - typicalDay) <= REGULAR_DAY_TOLERANCE);
  const amountFixed = amountVariation(occurrences.map((o) => o.amount)) <= FIXED_AMOUNT_TOLERANCE;

  // Valor E dia variando: só a repetição mensal não basta (pode ser um
  // delivery pedido ~1x/mês). Com só 2 meses, dia "regular" é coincidência
  // fácil — valor variável aí também não basta. Fica como "confira".
  if (!amountFixed && (!dayRegular || months.length < 3)) return { confidence: "LOW", months: months.length };

  const score = [months.length >= 3, coverage === 1, amountFixed, dayRegular].filter(Boolean).length;
  const confidence: Confidence = score === 4 ? "HIGH" : score >= 2 ? "MEDIUM" : "LOW";
  return { confidence, months: months.length };
}

function classifyAnnual(occurrences: Occurrence[]): Confidence | null {
  if (occurrences.length !== 2) return null;
  const [first, second] = [...occurrences].sort((a, b) => a.date.getTime() - b.date.getTime());
  const days = (second.date.getTime() - first.date.getTime()) / 86_400_000;
  if (days < 330 || days > 400) return null;
  return amountVariation([first.amount, second.amount]) <= FIXED_AMOUNT_TOLERANCE ? "MEDIUM" : "LOW";
}

/**
 * Detecta recorrências nas despesas informadas (idealmente 13 meses de
 * histórico: 12 para assinaturas mensais + o necessário para ver uma
 * cobrança anual repetir). `now` define o que ainda está ativo.
 */
export function detectRecurrences(transactions: RecurrenceTx[], now: Date): Recurrence[] {
  const groups = new Map<string, RecurrenceTx[]>();
  for (const t of transactions) {
    if (!t.amount.isNegative() || t.isInstallment || INSTALLMENT_PATTERN.test(t.description)) continue;
    const key = merchantKey(t.description);
    if (key.length < 3) continue;
    const group = groups.get(key);
    if (group) group.push(t);
    else groups.set(key, [t]);
  }

  const currentMonth = monthIndex(now);
  const recurrences: Recurrence[] = [];

  for (const [key, group] of groups) {
    const sorted = [...group].sort((a, b) => a.date.getTime() - b.date.getTime());
    const occurrences: Occurrence[] = sorted.map((t) => ({ date: t.date, amount: t.amount.abs() }));
    const last = sorted[sorted.length - 1];

    const monthly = classifyMonthly(occurrences);
    const annual = monthly ? null : classifyAnnual(occurrences);
    if (!monthly && !annual) continue;

    const cadence: Cadence = monthly ? "MONTHLY" : "ANNUAL";
    const confidence = monthly ? monthly.confidence : annual!;
    const amounts = occurrences.map((o) => o.amount);
    const expectedAmount = average(amounts.slice(-3));
    const dayOfMonth = median(occurrences.map((o) => o.date.getUTCDate()));

    const nextDate =
      cadence === "MONTHLY"
        ? expectedDateInMonth(last.date.getUTCFullYear(), last.date.getUTCMonth() + 1, dayOfMonth)
        : expectedDateInMonth(last.date.getUTCFullYear() + 1, last.date.getUTCMonth(), last.date.getUTCDate());

    const isActive =
      cadence === "MONTHLY" ? currentMonth - monthIndex(last.date) <= 1 : nextDate.getTime() >= now.getTime() - 31 * 86_400_000;

    const categoryNature = mostCommon(sorted.map((t) => t.categoryNature));
    const amountFixed = amountVariation(amounts) <= FIXED_AMOUNT_TOLERANCE;

    recurrences.push({
      key,
      name: last.description,
      cadence,
      kind: amountFixed && categoryNature !== "NEED" ? "SUBSCRIPTION" : "BILL",
      confidence,
      categoryId: mostCommon(sorted.map((t) => t.categoryId)),
      dayOfMonth,
      expectedAmount,
      monthlyCost: cadence === "MONTHLY" ? expectedAmount : expectedAmount.dividedBy(12).toDecimalPlaces(2),
      annualCost: cadence === "MONTHLY" ? expectedAmount.times(12) : expectedAmount,
      lastDate: last.date,
      nextDate,
      isActive,
      occurrences,
    });
  }

  return recurrences.sort((a, b) => b.annualCost.comparedTo(a.annualCost));
}

export type BillStatus = "PAID" | "UPCOMING" | "OVERDUE";

export interface CalendarEntry {
  recurrence: Recurrence;
  expectedDate: Date;
  status: BillStatus;
  /** Valor pago no mês (se pago) ou a estimativa. */
  amount: Decimal;
  paidDate: Date | null;
}

export interface BillCalendar {
  entries: CalendarEntry[];
  total: Decimal;
  paid: Decimal;
  pending: Decimal;
}

/**
 * Calendário de contas do mês de `now`: cada recorrência ativa com a data
 * prevista, se já foi paga neste mês (há cobrança dela no mês) e quanto.
 * Anuais só entram no mês em que vencem (ou em que foram pagas).
 */
export function buildBillCalendar(recurrences: Recurrence[], now: Date): BillCalendar {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const currentMonth = monthIndex(now);
  const today = Date.UTC(year, month, now.getUTCDate());

  const entries: CalendarEntry[] = [];
  for (const recurrence of recurrences) {
    // Confiança baixa não entra no calendário: um "atrasado?" falso é pior que nada.
    if (!recurrence.isActive || recurrence.confidence === "LOW") continue;

    const paidThisMonth = recurrence.occurrences.filter((o) => monthIndex(o.date) === currentMonth);
    let expectedDate: Date;
    if (recurrence.cadence === "MONTHLY") {
      expectedDate = expectedDateInMonth(year, month, recurrence.dayOfMonth);
    } else if (paidThisMonth.length > 0) {
      expectedDate = paidThisMonth[0].date;
    } else if (monthIndex(recurrence.nextDate) === currentMonth) {
      expectedDate = recurrence.nextDate;
    } else {
      continue;
    }

    if (paidThisMonth.length > 0) {
      entries.push({
        recurrence,
        expectedDate,
        status: "PAID",
        amount: paidThisMonth.reduce((sum, o) => sum.plus(o.amount), new Decimal(0)),
        paidDate: paidThisMonth[paidThisMonth.length - 1].date,
      });
    } else {
      const overdue = today > expectedDate.getTime() + OVERDUE_GRACE_DAYS * 86_400_000;
      entries.push({
        recurrence,
        expectedDate,
        status: overdue ? "OVERDUE" : "UPCOMING",
        amount: recurrence.expectedAmount,
        paidDate: null,
      });
    }
  }

  entries.sort((a, b) => a.expectedDate.getTime() - b.expectedDate.getTime() || a.recurrence.key.localeCompare(b.recurrence.key));
  const sum = (filter: (e: CalendarEntry) => boolean) =>
    entries.filter(filter).reduce((total, e) => total.plus(e.amount), new Decimal(0));

  return {
    entries,
    total: sum(() => true),
    paid: sum((e) => e.status === "PAID"),
    pending: sum((e) => e.status !== "PAID"),
  };
}
