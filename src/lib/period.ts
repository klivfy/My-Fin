export type PeriodKey = "current-month" | "previous-month" | "quarter" | "year";

export const PERIOD_OPTIONS: Array<{ value: PeriodKey; label: string }> = [
  { value: "current-month", label: "Mês atual" },
  { value: "previous-month", label: "Mês anterior" },
  { value: "quarter", label: "Trimestre" },
  { value: "year", label: "Ano" },
];

export interface PeriodRange {
  key: PeriodKey;
  label: string;
  from: Date;
  to: Date;
}

function startOfMonthUTC(year: number, month: number): Date {
  return new Date(Date.UTC(year, month, 1, 0, 0, 0));
}

function endOfMonthUTC(year: number, month: number): Date {
  return new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
}

/** Resolve a chave de período (vinda de `?period=`) para um intervalo de datas concreto. */
export function resolvePeriodRange(period?: string): PeriodRange {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const key: PeriodKey = isPeriodKey(period) ? period : "current-month";

  switch (key) {
    case "previous-month": {
      const prevMonth = month === 0 ? 11 : month - 1;
      const prevYear = month === 0 ? year - 1 : year;
      return { key, label: "Mês anterior", from: startOfMonthUTC(prevYear, prevMonth), to: endOfMonthUTC(prevYear, prevMonth) };
    }
    case "quarter": {
      const quarterStartMonth = month - 2 < 0 ? 0 : month - 2;
      return { key, label: "Trimestre", from: startOfMonthUTC(year, quarterStartMonth), to: endOfMonthUTC(year, month) };
    }
    case "year":
      return { key, label: "Ano", from: startOfMonthUTC(year, 0), to: endOfMonthUTC(year, 11) };
    case "current-month":
    default:
      return { key: "current-month", label: "Mês atual", from: startOfMonthUTC(year, month), to: endOfMonthUTC(year, month) };
  }
}

function isPeriodKey(value: string | undefined): value is PeriodKey {
  return !!value && PERIOD_OPTIONS.some((option) => option.value === value);
}
