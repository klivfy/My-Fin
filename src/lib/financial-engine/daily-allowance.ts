import Decimal from "decimal.js";

/**
 * "Cabem R$ X por dia" de um teto de categoria, já descontando as contas
 * recorrentes que ainda vão vencer no mês. Sem esse desconto o número é
 * otimista: o aluguel ou a assinatura que cai dia 28 aparece como dinheiro
 * livre até o dia em que cai.
 */
export interface DailyAllowanceInput {
  limit: Decimal;
  spent: Decimal;
  /** Soma das recorrentes da categoria ainda não pagas neste mês. */
  pendingBills: Decimal;
  /** Dias até o fim do mês, contando hoje (>= 1). */
  daysLeft: number;
}

export interface DailyAllowance {
  /** Parte do que resta no teto que já está comprometida com contas a vencer. */
  reserved: Decimal;
  /** O que cabe por dia depois das contas, arredondado para baixo em centavos. */
  perDay: Decimal;
}

export function dailyAllowance({ limit, spent, pendingBills, daysLeft }: DailyAllowanceInput): DailyAllowance {
  const remaining = Decimal.max(limit.minus(spent), 0);
  const reserved = Decimal.min(Decimal.max(pendingBills, 0), remaining);
  const days = Math.max(1, daysLeft);
  return {
    reserved,
    perDay: remaining.minus(reserved).div(days).toDecimalPlaces(2, Decimal.ROUND_DOWN),
  };
}
