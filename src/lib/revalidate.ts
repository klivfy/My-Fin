import { revalidatePath } from "next/cache";

const DASHBOARD_PATHS = ["/", "/transactions", "/review", "/recurring", "/accounts", "/budgets"] as const;

/**
 * Revalida as rotas do dashboard sem nunca deixar uma falha de invalidação
 * de cache (ex.: a Server Action sendo chamada fora do ciclo de uma
 * requisição Next.js real — como em `prisma/seed.ts` — dispara
 * "Invariant: static generation store missing") borbulhar como se a
 * operação de negócio que já foi persistida tivesse falhado.
 */
export function revalidateDashboard(): void {
  for (const path of DASHBOARD_PATHS) {
    try {
      revalidatePath(path);
    } catch {
      // ignorado deliberadamente — ver comentário acima.
    }
  }
}
