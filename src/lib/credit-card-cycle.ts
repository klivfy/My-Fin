import Decimal from "decimal.js";

/** Convenção de ciclo de fatura: fecha no dia 25, vence no dia 5 do mês seguinte. */
const CLOSING_DAY = 25;
const DUE_DAY = 5;

export interface InvoiceWindow {
  closingDate: Date;
  dueDate: Date;
}

function invoiceWindowForMonth(year: number, monthIndex: number): InvoiceWindow {
  const closingDate = new Date(Date.UTC(year, monthIndex, CLOSING_DAY));
  const dueDate = new Date(Date.UTC(year, monthIndex + 1, DUE_DAY));
  return { closingDate, dueDate };
}

/** Em qual mês de fatura uma compra feita em `date` cai, deslocada `monthsAhead` parcelas à frente. */
export function invoiceWindowForPurchase(date: Date, monthsAhead: number): InvoiceWindow {
  const rolledPastClosing = date.getUTCDate() > CLOSING_DAY ? 1 : 0;
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + rolledPastClosing + monthsAhead;
  return invoiceWindowForMonth(year, month);
}

/**
 * Divide o total em parcelas iguais, com o resto de arredondamento
 * absorvido pela última parcela (nunca a primeira — evita cobrar o cliente
 * "adiantado").
 */
export function splitInstallments(totalAmount: Decimal, totalInstallments: number): Decimal[] {
  const baseInstallment = totalAmount.dividedBy(totalInstallments).toDecimalPlaces(2, Decimal.ROUND_DOWN);
  const remainder = totalAmount.minus(baseInstallment.times(totalInstallments));
  return Array.from({ length: totalInstallments }, (_, i) =>
    i === totalInstallments - 1 ? baseInstallment.plus(remainder) : baseInstallment,
  );
}

export interface PlannedInstallment extends InvoiceWindow {
  installmentNumber: number;
  amount: Decimal;
}

/**
 * Distribui as parcelas pelas faturas, uma por mês a partir da janela da
 * compra. Faturas já pagas (`paidClosingDates`, em ISO) são puladas: a
 * parcela e as seguintes vão para a próxima fatura aberta, porque valor
 * somado a uma fatura liquidada nunca seria cobrado.
 */
export function planInstallments(input: {
  date: Date;
  amounts: Decimal[];
  paidClosingDates: ReadonlySet<string>;
}): PlannedInstallment[] {
  const plan: PlannedInstallment[] = [];
  let monthOffset = 0;
  input.amounts.forEach((amount, i) => {
    let invoiceWindow = invoiceWindowForPurchase(input.date, i + monthOffset);
    while (input.paidClosingDates.has(invoiceWindow.closingDate.toISOString())) {
      monthOffset += 1;
      invoiceWindow = invoiceWindowForPurchase(input.date, i + monthOffset);
    }
    plan.push({ installmentNumber: i + 1, amount, ...invoiceWindow });
  });
  return plan;
}
