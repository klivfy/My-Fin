import type { Allocation, AllocStep } from "@/lib/insights/allocator";

/**
 * Regras do painel "Próximos passos". Funções puras sobre o retrato do mês:
 * cada sugestão tem id estável (para dispensar), impacto em R$/mês, o porquê
 * e a tela onde se age. Nunca cita ativo, ticker ou rentabilidade.
 */

export const MIN_CATEGORIZED_SHARE = 0.8;
export const MAX_SUGGESTIONS = 3;

export interface Suggestion {
  id: string;
  title: string;
  /** O porquê, com os números que o justificam. */
  detail: string;
  /** Quanto por mês a sugestão move; 0 quando é uma pendência de dado. */
  impactMonthly: number;
  href: string;
  cta: string;
}

export interface SuggestionInput {
  hasTransactions: boolean;
  /** Aporte mensal (já com folga) vindo da sobra real; null sem meses completos suficientes. */
  contribution: number | null;
  /** Fração do gasto dos últimos meses com categoria; null sem gasto. */
  categorizedShare: number | null;
  allocation: Allocation | null;
}

const brl = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
const pct = (n: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(n);

function fromStep(step: AllocStep, rank: number): Suggestion {
  const amount = step.amount.toNumber();
  switch (step.kind) {
    case "RESERVA_MINIMA":
      return {
        id: step.id,
        title: `Monte a reserva mínima: ${brl(amount)}/mês`,
        detail:
          "Sem 1 mês de custo essencial guardado, qualquer imprevisto vira dívida nova. É a primeira da fila antes de investir ou acelerar dívida.",
        impactMonthly: amount,
        href: "/budgets",
        cta: "Ver metas",
      };
    case "DIVIDA":
      return {
        id: step.id,
        title: `${rank === 0 ? "Ataque" : "Depois, ataque"} ${step.label}: ${brl(amount)}/mês`,
        detail:
          step.ratePct !== undefined && step.ratePct > 1
            ? `Juro de ${pct(step.ratePct)}% ao mês: nenhum investimento seguro rende isso, então cada real adiantado aqui vale mais.`
            : `Juro de ${pct(step.ratePct ?? 0)}% ao mês, mais baixo: entra depois da reserva completa.`,
        impactMonthly: amount,
        href: "/dividas",
        cta: "Ver plano",
      };
    case "RESERVA_COMPLETA":
      return {
        id: step.id,
        title: `Complete a reserva de 6 meses: ${brl(amount)}/mês`,
        detail: "Com as dívidas caras sob controle, a reserva completa é o próximo degrau antes de metas e investimentos.",
        impactMonthly: amount,
        href: "/budgets",
        cta: "Ver metas",
      };
    case "META":
      return {
        id: step.id,
        title: `Aporte na meta ${step.label}: ${brl(amount)}/mês`,
        detail: "Reserva e dívidas caras já estão atendidas, então a sobra pode ir para as suas metas.",
        impactMonthly: amount,
        href: "/budgets",
        cta: "Ver metas",
      };
    case "LIVRE":
      return {
        id: step.id,
        title: `${brl(amount)}/mês livres para investir`,
        detail:
          "Reserva completa, dívidas e metas atendidas. Prefira renda fixa para o que tem prazo curto e renda variável só para o que fica anos parado. O app não indica ativos.",
        impactMonthly: amount,
        href: "/investimentos",
        cta: "Ver carteira",
      };
  }
}

/** Todas as sugestões possíveis, em ordem de prioridade (não filtradas, não limitadas). */
export function buildSuggestions(input: SuggestionInput): Suggestion[] {
  if (!input.hasTransactions) return [];

  // Dado ruim: não sugere valor. A única sugestão é consertar o dado.
  if (input.categorizedShare !== null && input.categorizedShare < MIN_CATEGORIZED_SHARE) {
    return [
      {
        id: "data:categorizar",
        title: "Categorize seus gastos antes de seguir as sugestões",
        detail: `Só ${pct(input.categorizedShare * 100)}% dos gastos recentes têm categoria (o mínimo é ${pct(MIN_CATEGORIZED_SHARE * 100)}%). Com o resto fora da conta, a sobra parece maior do que é.`,
        impactMonthly: 0,
        href: "/review",
        cta: "Revisar",
      },
    ];
  }

  if (input.contribution === null) {
    return [
      {
        id: "data:meses",
        title: "Faltam meses completos de extrato",
        detail: "As sugestões partem da sobra real dos últimos meses. Importe pelo menos dois meses completos.",
        impactMonthly: 0,
        href: "/transactions",
        cta: "Ver extrato",
      },
    ];
  }

  if (input.contribution <= 0 || !input.allocation || input.allocation.steps.length === 0) {
    return [
      {
        id: "alloc:sem-sobra",
        title: "Sem sobra nos últimos meses",
        detail: "Antes de reserva, dívida ou investimento, o caminho é cortar: veja os cortes sugeridos na regra 50/30/20.",
        impactMonthly: 0,
        href: "/budgets",
        cta: "Ver cortes",
      },
    ];
  }

  let debtRank = 0;
  return input.allocation.steps.map((step) => fromStep(step, step.kind === "DIVIDA" ? debtRank++ : 0));
}

/** O que o painel mostra: sem as dispensadas, no máximo `MAX_SUGGESTIONS`, na ordem da fila. */
export function pickSuggestions(all: Suggestion[], dismissed: ReadonlySet<string>): Suggestion[] {
  return all.filter((s) => !dismissed.has(s.id)).slice(0, MAX_SUGGESTIONS);
}
