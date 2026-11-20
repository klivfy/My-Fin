import { prisma } from "@/lib/prisma";
import { getFinancialSnapshot } from "@/lib/queries/snapshot";
import { getBridgeInput } from "@/lib/queries/bridges";
import { bridgeSuggestions, mergeSuggestions } from "@/lib/insights/bridges";
import { buildSuggestions, pickSuggestions, type Suggestion } from "@/lib/insights/suggestions";

export interface NextSteps {
  suggestions: Suggestion[];
  /** Quantas sugestões o usuário já dispensou (para oferecer "mostrar de novo"). */
  dismissedCount: number;
}

/** Painel "Próximos passos" da Visão geral. */
export async function getNextSteps(now = new Date()): Promise<NextSteps> {
  const [snapshot, dismissals] = await Promise.all([getFinancialSnapshot(now), prisma.insightDismissal.findMany()]);
  const queue = buildSuggestions({
    hasTransactions: snapshot.hasTransactions,
    contribution: snapshot.goals.surplus?.contribution ?? null,
    categorizedShare: snapshot.categorizedShare,
    allocation: snapshot.allocation,
  });
  // Sem transação não há retrato: as pontes também ficam quietas.
  const all = snapshot.hasTransactions
    ? mergeSuggestions(queue, bridgeSuggestions(await getBridgeInput(snapshot, now)))
    : queue;
  const dismissed = new Set(dismissals.map((d) => d.id));
  return {
    suggestions: pickSuggestions(all, dismissed),
    dismissedCount: all.filter((s) => dismissed.has(s.id)).length,
  };
}
