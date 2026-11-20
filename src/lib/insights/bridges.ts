import type { Suggestion } from "@/lib/insights/suggestions";
import { EXPENSIVE_DEBT_RATE_PCT, FULL_RESERVE_MONTHS } from "@/lib/insights/allocator";

/**
 * Pontes entre telas que não passam pela fila da sobra: cada regra cruza dois
 * módulos que antes não se falavam (cartão e Dívidas, recorrentes e cortes,
 * trading e Dívidas, limites de perda e sobra, corretora e reserva).
 * Funções puras: recebem números, devolvem sugestões com id estável.
 * Nunca citam ativo, ticker ou rentabilidade.
 */

/** Assinaturas a partir de 3% da renda média (e R$ 50) merecem uma revisão. */
export const SUBSCRIPTION_INCOME_SHARE = 0.03;
export const SUBSCRIPTION_MIN_MONTHLY = 50;
/** Janela do resultado de trading usada na ponte com dívidas. */
export const TRADING_WINDOW_DAYS = 60;

export interface BridgeInput {
  /** Faturas de cartão vencidas e não pagas; null/zero = nenhuma. */
  overdueInvoices: { total: number; count: number } | null;
  /** Assinaturas ativas; renda média mensal dos meses usados na sobra. */
  subscriptions: { monthly: number; annual: number; top: Array<{ name: string; monthly: number }> } | null;
  avgIncome: number | null;
  /** Maior juro mensal (%) entre as dívidas cadastradas e o saldo somado das caras. */
  expensiveDebt: { maxRatePct: number; balance: number } | null;
  /** Trading real: resultado líquido e operações fechadas na janela; limite mensal de perda. */
  trading: { closed: number; net: number; maxLossMonth: number | null } | null;
  /** Sobra média mensal (pode ser negativa); null sem meses completos. */
  averageSurplus: number | null;
  /** Saldo em poupança (reserva líquida), em corretora e custo essencial mensal. */
  reserveBalance: number;
  investmentBalance: number;
  monthlyEssential: number | null;
}

export interface BridgeSuggestions {
  /** Vêm antes da fila da sobra: dinheiro vazando ou risco agindo agora. */
  leading: Suggestion[];
  /** Cortes que aumentam a sobra: entram logo depois do primeiro passo da fila. */
  cuts: Suggestion[];
  /** Avisos de contexto: depois da fila. */
  trailing: Suggestion[];
}

const brl = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
const pct = (n: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(n);

export function bridgeSuggestions(input: BridgeInput): BridgeSuggestions {
  const out: BridgeSuggestions = { leading: [], cuts: [], trailing: [] };

  // Ponte 2: fatura vencida. Se não for paga, vira rotativo, a dívida mais cara que existe.
  if (input.overdueInvoices && input.overdueInvoices.total > 0) {
    const { total, count } = input.overdueInvoices;
    out.leading.push({
      id: "card:fatura-vencida",
      title: `${count === 1 ? "Fatura vencida" : `${count} faturas vencidas`} de ${brl(total)}`,
      detail:
        "Fatura não paga vira rotativo, o crédito mais caro do mercado. Pague o valor inteiro ou registre o parcelamento em Dívidas para ver o custo real e entrar no plano de quitação.",
      impactMonthly: 0,
      href: "/dividas",
      cta: "Registrar dívida",
    });
  }

  // Ponte 3: assinaturas recorrentes pesando na renda viram corte.
  const subs = input.subscriptions;
  if (subs && input.avgIncome && input.avgIncome > 0) {
    const share = subs.monthly / input.avgIncome;
    if (subs.monthly >= SUBSCRIPTION_MIN_MONTHLY && share >= SUBSCRIPTION_INCOME_SHARE) {
      const names = subs.top
        .slice(0, 3)
        .map((t) => `${t.name} (${brl(t.monthly)})`)
        .join(", ");
      out.cuts.push({
        id: "cut:assinaturas",
        title: `Assinaturas somam ${brl(subs.monthly)}/mês (${brl(subs.annual)} por ano)`,
        detail: `São ${pct(share * 100)}% da sua renda média. Maiores: ${names}. Cancelar o que você não usa aumenta a sobra que alimenta a fila, sem apertar o resto do orçamento.`,
        impactMonthly: subs.monthly,
        href: "/recurring",
        cta: "Revisar",
      });
    }
  }

  // Ponte 6: operar na bolsa devendo juro alto. Quitar rende o juro da dívida, garantido.
  const debt = input.expensiveDebt;
  const trading = input.trading;
  if (debt && debt.maxRatePct > EXPENSIVE_DEBT_RATE_PCT && trading && trading.closed > 0) {
    const losing = trading.net < 0;
    const s: Suggestion = {
      id: "trade:divida",
      title: `Você opera na bolsa devendo a ${pct(debt.maxRatePct)}% ao mês`,
      detail: `Quitar a dívida (saldo caro de ${brl(debt.balance)}) rende esse juro com certeza. O trading precisa bater isso depois de custos e imposto, todo mês. Resultado dos últimos ${TRADING_WINDOW_DAYS} dias: ${brl(trading.net)}.`,
      impactMonthly: 0,
      href: "/dividas",
      cta: "Ver dívidas",
    };
    (losing ? out.leading : out.trailing).push(s);
  }

  // Ponte 7: limite de perda mensal do trading contra a sobra do mês.
  if (trading?.maxLossMonth && trading.maxLossMonth > 0 && input.averageSurplus !== null) {
    const surplus = Math.max(input.averageSurplus, 0);
    if (trading.maxLossMonth > surplus) {
      out.trailing.push({
        id: "trade:limite-vs-sobra",
        title: `Seu limite de perda no mês (${brl(trading.maxLossMonth)}) passa da sua sobra (${brl(surplus)})`,
        detail:
          "Se o dinheiro do trading vem do salário, uma perda dentro do limite consome toda a sobra e ainda mexe na reserva. Reveja o limite ou separe um capital que você aceite perder.",
        impactMonthly: 0,
        href: "/trading/risco",
        cta: "Rever limites",
      });
    }
  }

  // Ponte 8: renda variável não é reserva. Cai justamente quando se precisa vender.
  if (
    input.monthlyEssential &&
    input.monthlyEssential > 0 &&
    input.investmentBalance >= input.monthlyEssential &&
    input.reserveBalance < input.monthlyEssential * FULL_RESERVE_MONTHS
  ) {
    const months = input.reserveBalance / input.monthlyEssential;
    out.trailing.push({
      id: "reserva:renda-variavel",
      title: `${brl(input.investmentBalance)} na corretora não contam como reserva`,
      detail: `Renda variável oscila e tende a cair junto com o imprevisto. Sua reserva líquida (${brl(input.reserveBalance)}) cobre ${pct(months)} de ${FULL_RESERVE_MONTHS} meses de custo essencial.`,
      impactMonthly: 0,
      href: "/budgets",
      cta: "Ver metas",
    });
  }

  return out;
}

/**
 * Junta a fila da sobra com as pontes: urgentes primeiro, cortes logo depois do
 * primeiro passo da fila (eles aumentam a sobra que a fila distribui), avisos no fim.
 * Sugestão de dado ruim (`data:*`) continua sozinha: sem dado confiável nada mais vale.
 */
export function mergeSuggestions(queue: Suggestion[], bridges: BridgeSuggestions): Suggestion[] {
  if (queue.some((s) => s.id.startsWith("data:"))) return queue;
  return [...bridges.leading, ...queue.slice(0, 1), ...bridges.cuts, ...queue.slice(1), ...bridges.trailing];
}
