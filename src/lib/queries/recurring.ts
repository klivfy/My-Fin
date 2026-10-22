import { prisma } from "@/lib/prisma";
import { toDecimal } from "@/lib/money";
import {
  buildBillCalendar,
  detectRecurrences,
  type BillStatus,
  type Cadence,
  type Confidence,
  type Recurrence,
} from "@/lib/financial-engine/recurrence";

/** 13 meses: 12 para assinaturas mensais + o bastante para uma anual repetir. */
const LOOKBACK_MONTHS = 13;

export interface RecurringItem {
  key: string;
  name: string;
  cadence: Cadence;
  confidence: Confidence;
  categoryName: string | null;
  dayOfMonth: number;
  expectedAmount: number;
  monthlyCost: number;
  annualCost: number;
  lastDate: string;
  occurrences: number;
}

export interface CalendarItem extends RecurringItem {
  kind: "SUBSCRIPTION" | "BILL";
  expectedDate: string;
  status: BillStatus;
  amount: number;
  paidDate: string | null;
}

export interface RecurringData {
  monthLabel: string;
  calendar: { entries: CalendarItem[]; total: number; paid: number; pending: number };
  subscriptions: { items: RecurringItem[]; monthlyTotal: number; annualTotal: number };
  /** Ativas, mas com confiança baixa: o usuário confirma ou descarta. */
  possible: RecurringItem[];
  /** Detectadas mas sem cobrança no mês corrente nem no anterior. */
  inactive: RecurringItem[];
  ignored: string[];
}

export async function getRecurringData(now = new Date()): Promise<RecurringData> {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - LOOKBACK_MONTHS, 1));

  const [transactions, categories, ignoredRows] = await Promise.all([
    prisma.transaction.findMany({
      where: { account: { isActive: true }, type: "EXPENSE", date: { gte: from, lte: now } },
      select: {
        date: true,
        amount: true,
        description: true,
        categoryId: true,
        totalInstallments: true,
        category: { select: { nature: true } },
      },
    }),
    prisma.category.findMany({ select: { id: true, name: true } }),
    prisma.recurrenceIgnore.findMany({ orderBy: { key: "asc" }, select: { key: true } }),
  ]);

  const ignored = new Set(ignoredRows.map((r) => r.key));
  const categoryNames = new Map(categories.map((c) => [c.id, c.name]));

  const recurrences = detectRecurrences(
    transactions.map((t) => ({
      date: t.date,
      amount: toDecimal(t.amount.toString()),
      description: t.description,
      categoryId: t.categoryId,
      categoryNature: t.category?.nature ?? null,
      isInstallment: t.totalInstallments !== null,
    })),
    now,
  ).filter((r) => !ignored.has(r.key));

  const toItem = (r: Recurrence): RecurringItem => ({
    key: r.key,
    name: r.name,
    cadence: r.cadence,
    confidence: r.confidence,
    categoryName: r.categoryId ? (categoryNames.get(r.categoryId) ?? null) : null,
    dayOfMonth: r.dayOfMonth,
    expectedAmount: r.expectedAmount.toNumber(),
    monthlyCost: r.monthlyCost.toNumber(),
    annualCost: r.annualCost.toNumber(),
    lastDate: r.lastDate.toISOString(),
    occurrences: r.occurrences.length,
  });

  const calendar = buildBillCalendar(recurrences, now);
  const activeSubscriptions = recurrences.filter(
    (r) => r.isActive && r.kind === "SUBSCRIPTION" && r.confidence !== "LOW",
  );
  const sum = (values: Recurrence[], pick: (r: Recurrence) => typeof r.monthlyCost) =>
    values.reduce((total, r) => total.plus(pick(r)), toDecimal(0)).toNumber();

  return {
    monthLabel: new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(now),
    calendar: {
      entries: calendar.entries.map((e) => ({
        ...toItem(e.recurrence),
        kind: e.recurrence.kind,
        expectedDate: e.expectedDate.toISOString(),
        status: e.status,
        amount: e.amount.toNumber(),
        paidDate: e.paidDate?.toISOString() ?? null,
      })),
      total: calendar.total.toNumber(),
      paid: calendar.paid.toNumber(),
      pending: calendar.pending.toNumber(),
    },
    subscriptions: {
      items: activeSubscriptions.map(toItem),
      monthlyTotal: sum(activeSubscriptions, (r) => r.monthlyCost),
      annualTotal: sum(activeSubscriptions, (r) => r.annualCost),
    },
    possible: recurrences.filter((r) => r.isActive && r.confidence === "LOW").map(toItem),
    inactive: recurrences.filter((r) => !r.isActive).map(toItem),
    ignored: [...ignored],
  };
}
