import { PrismaClient } from "@prisma/client";

/**
 * Singleton do PrismaClient.
 *
 * Em desenvolvimento, o Next.js recarrega módulos a cada mudança (HMR); para
 * evitar esgotar o pool de conexões do Postgres, guardamos a instância em
 * `globalThis` e a reaproveitamos entre reloads. Em produção (funções
 * da Vercel), cada instância nova da função cria um client novo; por isso
 * `DATABASE_URL` aponta para o pooler do Supabase em modo transaction
 * (porta 6543, `pgbouncer=true`, `connection_limit=1`; veja .env.example).
 */

declare global {
  var __prisma: PrismaClient | undefined;
}

export const prisma =
  globalThis.__prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__prisma = prisma;
}
