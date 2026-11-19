/**
 * Cliente mínimo da API do Pluggy (https://docs.pluggy.ai), só para o
 * servidor. As credenciais vêm de variáveis de ambiente e nunca são
 * registradas em log nem devolvidas ao navegador.
 *
 * Fluxo: POST /auth troca clientId + clientSecret por uma apiKey (vale 2 h),
 * enviada depois no cabeçalho X-API-KEY.
 */

export const PLUGGY_BASE_URL = "https://api.pluggy.ai";
/** A apiKey vale 2 h; renova antes para não expirar no meio de uma sincronização. */
const API_KEY_TTL_MS = 100 * 60 * 1000;
/** Teto de páginas por listagem: protege contra resposta inesperada que nunca termina. */
const MAX_PAGES = 50;

export interface PluggyCredentials {
  clientId: string;
  clientSecret: string;
}

export class PluggyError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export function pluggyCredentials(
  env: Record<string, string | undefined> = process.env,
): PluggyCredentials | null {
  const clientId = env.PLUGGY_CLIENT_ID?.trim();
  const clientSecret = env.PLUGGY_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export interface PluggyItem {
  id: string;
  /** UPDATED, UPDATING, WAITING_USER_INPUT, LOGIN_ERROR, OUTDATED. */
  status: string;
  executionStatus?: string | null;
  lastUpdatedAt?: string | null;
  connector?: { id?: number; name?: string } | null;
}

export interface PluggyInvestment {
  id: string;
  itemId?: string;
  code?: string | null;
  name: string;
  /** COE, EQUITY, ETF, FIXED_INCOME, MUTUAL_FUND, SECURITY, OTHER. */
  type: string;
  subtype?: string | null;
  institution?: { name?: string | null } | null;
}

export interface PluggyInvestmentTransaction {
  id: string;
  /** BUY, SELL e outros (taxas, transferências), que não são negócios. */
  type: string;
  quantity?: number | null;
  /** Preço unitário. */
  value?: number | null;
  /** Valor bruto da operação. */
  amount?: number | null;
  tradeDate?: string | null;
  date: string;
  brokerageNumber?: string | null;
  expenses?: Record<string, number | null> | null;
}

interface Page<T> {
  page: number;
  total: number;
  totalPages: number;
  results: T[];
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

async function messageOf(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: unknown };
    if (typeof body.message === "string" && body.message) return body.message;
  } catch {
    // corpo sem JSON
  }
  return `HTTP ${res.status}`;
}

export function createPluggyClient(
  credentials: PluggyCredentials,
  fetchImpl: FetchLike = fetch,
) {
  let cached: { value: string; expiresAt: number } | null = null;

  async function apiKey(force = false): Promise<string> {
    if (!force && cached && cached.expiresAt > Date.now()) return cached.value;
    const res = await fetchImpl(`${PLUGGY_BASE_URL}/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
      }),
      cache: "no-store",
    });
    if (res.status === 401 || res.status === 403) {
      throw new PluggyError(
        "O Pluggy recusou as credenciais. Confira PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET.",
        res.status,
      );
    }
    if (!res.ok)
      throw new PluggyError(
        `Falha ao autenticar no Pluggy: ${await messageOf(res)}.`,
        res.status,
      );
    const { apiKey: value } = (await res.json()) as { apiKey?: string };
    if (!value)
      throw new PluggyError("O Pluggy não devolveu a chave de acesso.");
    cached = { value, expiresAt: Date.now() + API_KEY_TTL_MS };
    return value;
  }

  async function request<T>(
    path: string,
    init: RequestInit = {},
    retried = false,
  ): Promise<T> {
    const res = await fetchImpl(`${PLUGGY_BASE_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...init.headers,
        "X-API-KEY": await apiKey(retried),
      },
      cache: "no-store",
    });
    if (res.status === 401 && !retried) return request<T>(path, init, true);
    if (res.status === 404)
      throw new PluggyError("Não encontrado no Pluggy.", 404);
    if (!res.ok)
      throw new PluggyError(
        `Erro do Pluggy: ${await messageOf(res)}.`,
        res.status,
      );
    return (await res.json()) as T;
  }

  async function paginate<T>(
    path: string,
    params: Record<string, string>,
  ): Promise<T[]> {
    const all: T[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const qs = new URLSearchParams({
        ...params,
        page: String(page),
        pageSize: "500",
      });
      const data = await request<Page<T>>(`${path}?${qs}`);
      all.push(...data.results);
      if (page >= data.totalPages || data.results.length === 0) return all;
    }
    throw new PluggyError(`Listagem do Pluggy passou de ${MAX_PAGES} páginas.`);
  }

  return {
    /** Token de 30 min para o widget Pluggy Connect; com itemId, reconecta um item existente. */
    async createConnectToken(itemId?: string): Promise<string> {
      const data = await request<{ accessToken?: string }>("/connect_token", {
        method: "POST",
        body: JSON.stringify(itemId ? { itemId } : {}),
      });
      if (!data.accessToken)
        throw new PluggyError("O Pluggy não devolveu o token de conexão.");
      return data.accessToken;
    },
    getItem(id: string): Promise<PluggyItem> {
      return request<PluggyItem>(`/items/${encodeURIComponent(id)}`);
    },
    listInvestments(itemId: string): Promise<PluggyInvestment[]> {
      return paginate<PluggyInvestment>("/investments", { itemId });
    },
    /** `from` em YYYY-MM-DD (dia inteiro). */
    listInvestmentTransactions(
      investmentId: string,
      from?: string,
    ): Promise<PluggyInvestmentTransaction[]> {
      return paginate<PluggyInvestmentTransaction>(
        `/investments/${encodeURIComponent(investmentId)}/transactions`,
        from ? { from } : {},
      );
    },
  };
}

export type PluggyClient = ReturnType<typeof createPluggyClient>;
