/**
 * Apoio aos testes de integração que precisam de um Postgres real
 * (transações concorrentes, travas de linha).
 *
 * Só rodam com `TEST_DATABASE_URL` definida, apontando para um banco
 * descartável com as migrações aplicadas (`prisma migrate deploy`). Cada
 * teste esvazia as tabelas, então o nome do banco precisa conter "test"
 * para não apagar por engano o banco de desenvolvimento ou de produção.
 */

export const testDatabaseUrl = process.env.TEST_DATABASE_URL;

/** Motivo para `{ skip }` do node:test quando não há banco de teste. */
export const skipWithoutDb = testDatabaseUrl ? false : "defina TEST_DATABASE_URL para rodar os testes de banco";

if (testDatabaseUrl) {
  const databaseName = new URL(testDatabaseUrl).pathname.slice(1);
  if (!databaseName.includes("test")) {
    throw new Error(`TEST_DATABASE_URL deve apontar para um banco de teste (nome atual: "${databaseName}").`);
  }
  // Precisa acontecer antes do primeiro import de "@/lib/prisma".
  process.env.DATABASE_URL = testDatabaseUrl;
}

export async function loadPrisma() {
  const { prisma } = await import("@/lib/prisma");
  return prisma;
}

export async function resetDatabase() {
  const prisma = await loadPrisma();
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "credit_card_invoices", "transfers", "transactions", "sync_logs", "categories", "accounts" CASCADE',
  );
}

export async function createAccount(data: {
  name?: string;
  type: "CHECKING" | "SAVINGS" | "CREDIT_CARD" | "INVESTMENT" | "CASH";
  balance?: string;
  isActive?: boolean;
}) {
  const prisma = await loadPrisma();
  const balance = data.balance ?? "0.00";
  return prisma.account.create({
    data: {
      name: data.name ?? data.type,
      type: data.type,
      initialBalance: balance,
      currentBalance: balance,
      isActive: data.isActive ?? true,
    },
  });
}

/** `currentBalance` precisa ser sempre `initialBalance + soma(amount)`. */
export async function ledgerDrift(accountId: string): Promise<string> {
  const prisma = await loadPrisma();
  const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
  const sum = await prisma.transaction.aggregate({ where: { accountId }, _sum: { amount: true } });
  return account.currentBalance
    .minus(account.initialBalance)
    .minus(sum._sum.amount ?? 0)
    .toFixed(2);
}
