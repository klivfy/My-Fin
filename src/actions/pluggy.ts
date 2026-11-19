"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import {
  runAction,
  UserFacingError,
  type ActionResult,
} from "@/lib/action-result";
import { open, seal, SecretBoxError } from "@/lib/crypto/secret-box";
import { pairAcrossSources, withMatchKeys } from "@/lib/investments/common";
import {
  createPluggyClient,
  pluggyCredentials,
  PluggyError,
  type PluggyClient,
} from "@/lib/investments/pluggy-client";
import { mapPluggyTrades, TRADED_TYPES } from "@/lib/investments/pluggy-map";
import {
  storedTrades,
  tradeData,
  withSyncLog,
  type ImportResult,
} from "@/lib/investments/persist";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Relê alguns dias antes da última sincronização: a corretora pode lançar negócios com atraso. */
const OVERLAP_DAYS = 10;
const TX_OPTIONS = { timeout: 30_000, maxWait: 10_000 };

export interface PluggySyncResult extends ImportResult {
  /** Movimentos que não são compra ou venda de ativo de bolsa (taxas, renda fixa etc.). */
  ignored: number;
  /** Conexões que falharam, com o motivo. */
  failures: string[];
}

function revalidateInvestments() {
  try {
    revalidatePath("/investimentos");
  } catch {
    // fora de uma requisição Next
  }
}

function pluggy(): PluggyClient {
  const credentials = pluggyCredentials();
  if (!credentials) {
    throw new UserFacingError(
      "Open Finance não configurado: faltam PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET nas variáveis do servidor.",
    );
  }
  return createPluggyClient(credentials);
}

/** Erros esperados do Pluggy e da cifra viram mensagem para a tela; o resto segue como erro. */
function asUserFacing(error: unknown): unknown {
  if (error instanceof PluggyError) {
    return new UserFacingError(
      error.status === 404
        ? "Conexão não encontrada no Pluggy. Confira o id do item."
        : error.message,
    );
  }
  if (error instanceof SecretBoxError)
    return new UserFacingError(error.message);
  return error;
}

const daysBefore = (d: Date, days: number) =>
  new Date(d.getTime() - days * 86_400_000).toISOString().slice(0, 10);

type Connection = {
  id: string;
  label: string;
  encryptedRef: string;
  lastSyncAt: Date | null;
};

async function syncConnection(
  api: PluggyClient,
  conn: Connection,
): Promise<Omit<PluggySyncResult, "failures">> {
  const itemId = open(conn.encryptedRef);
  const item = await api.getItem(itemId);
  if (item.status === "LOGIN_ERROR" || item.status === "WAITING_USER_INPUT") {
    await prisma.investmentConnection.update({
      where: { id: conn.id },
      data: { status: "EXPIRED" },
    });
    throw new UserFacingError(
      `${conn.label}: a corretora pede login de novo no Pluggy. Reconecte para sincronizar.`,
    );
  }

  const since = conn.lastSyncAt
    ? daysBefore(conn.lastSyncAt, OVERLAP_DAYS)
    : undefined;
  const investments = (await api.listInvestments(itemId)).filter((i) =>
    TRADED_TYPES.has(i.type),
  );
  const rows = [];
  for (const investment of investments) {
    rows.push({
      investment,
      transactions: await api.listInvestmentTransactions(investment.id, since),
    });
  }
  const { trades, ignored } = mapPluggyTrades(
    rows,
    item.connector?.name ?? conn.label,
  );
  const keyed = withMatchKeys(trades);

  const result = await withSyncLog("PLUGGY", (syncLogId) =>
    prisma.$transaction(async (tx) => {
      const known = await tx.investmentTrade.findMany({
        where: { matchKey: { in: keyed.map((t) => t.matchKey) } },
        select: { matchKey: true },
      });
      const knownKeys = new Set(known.map((k) => k.matchKey));
      const fresh = keyed.filter((t) => !knownKeys.has(t.matchKey));
      // Negócio que já veio da B3 ou de uma nota fica como está: o Pluggy não duplica.
      const stored = await storedTrades(
        tx,
        fresh.map((t) => t.tradeDate),
        {},
      );
      const { pairs, unmatched } = pairAcrossSources(fresh, stored);
      const { count } = await tx.investmentTrade.createMany({
        data: unmatched.map((t) => ({
          ...tradeData(t, "PLUGGY", syncLogId),
          fees: t.fees.toFixed(2),
        })),
        skipDuplicates: true,
      });
      return {
        read: keyed.length,
        inserted: count,
        matched: pairs.length,
        skipped: keyed.length - count - pairs.length,
      };
    }, TX_OPTIONS),
  );

  await prisma.investmentConnection.update({
    where: { id: conn.id },
    data: { lastSyncAt: new Date(), status: "ACTIVE" },
  });
  return { ...result, ignored };
}

/**
 * Cadastra uma conexão do Pluggy pelo id do item e já sincroniza. O id é
 * guardado cifrado (AES-256-GCM); as credenciais da corretora ficam no Pluggy.
 */
export async function connectPluggyItem(
  formData: FormData,
): Promise<ActionResult<PluggySyncResult>> {
  return runAction(async () => {
    const itemId = String(formData.get("itemId") ?? "").trim();
    if (!UUID.test(itemId)) {
      throw new UserFacingError(
        "O id do item tem 36 caracteres no formato 8-4-4-4-12, com hífens.",
      );
    }
    const api = pluggy();
    try {
      const item = await api.getItem(itemId);
      const existing = await prisma.investmentConnection.findMany({
        where: { provider: "PLUGGY" },
        select: { encryptedRef: true },
      });
      if (existing.some((c) => open(c.encryptedRef) === itemId)) {
        throw new UserFacingError("Essa conexão já está cadastrada.");
      }
      const conn = await prisma.investmentConnection.create({
        data: {
          provider: "PLUGGY",
          label: item.connector?.name ?? "Corretora via Pluggy",
          encryptedRef: seal(itemId),
        },
      });
      const result = await syncConnection(api, conn);
      revalidateInvestments();
      return { ...result, failures: [] };
    } catch (error) {
      revalidateInvestments();
      throw asUserFacing(error);
    }
  });
}

/** Sincroniza todas as conexões do Pluggy. Uma conexão com erro não impede as outras. */
export async function syncPluggy(): Promise<ActionResult<PluggySyncResult>> {
  return runAction(async () => {
    const api = pluggy();
    const connections = await prisma.investmentConnection.findMany({
      where: { provider: "PLUGGY", status: { not: "REVOKED" } },
      select: { id: true, label: true, encryptedRef: true, lastSyncAt: true },
      orderBy: { createdAt: "asc" },
    });
    if (connections.length === 0)
      throw new UserFacingError("Nenhuma conexão do Pluggy cadastrada.");

    const total: PluggySyncResult = {
      read: 0,
      inserted: 0,
      matched: 0,
      skipped: 0,
      ignored: 0,
      failures: [],
    };
    for (const conn of connections) {
      try {
        const r = await syncConnection(api, conn);
        total.read += r.read;
        total.inserted += r.inserted;
        total.matched += r.matched;
        total.skipped += r.skipped;
        total.ignored += r.ignored;
      } catch (error) {
        const friendly = asUserFacing(error);
        if (!(friendly instanceof UserFacingError)) throw error;
        if (!(error instanceof UserFacingError)) {
          await prisma.investmentConnection.update({
            where: { id: conn.id },
            data: { status: "ERROR" },
          });
        }
        total.failures.push(
          friendly.message.startsWith(conn.label)
            ? friendly.message
            : `${conn.label}: ${friendly.message}`,
        );
      }
    }
    revalidateInvestments();
    if (total.failures.length === connections.length)
      throw new UserFacingError(total.failures.join(" "));
    return total;
  });
}

/** Remove a conexão do app. Os negócios já importados ficam; o item continua no Pluggy. */
export async function disconnectPluggy(
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const id = String(formData.get("id") ?? "");
    const { count } = await prisma.investmentConnection.deleteMany({
      where: { id, provider: "PLUGGY" },
    });
    if (count === 0) throw new UserFacingError("Conexão não encontrada.");
    revalidateInvestments();
    return undefined;
  });
}
