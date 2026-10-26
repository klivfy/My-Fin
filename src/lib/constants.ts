/**
 * Constantes de domínio/infra compartilhadas entre Server Actions, queries
 * e configuração. Valores de segurança e de importação ficam aqui para não
 * se dispersarem como números mágicos pelo código.
 */

/** Rotas revalidadas após qualquer mutação financeira. */
export const DASHBOARD_PATHS = ["/", "/transactions", "/accounts", "/budgets"] as const;

/** Cookie de sessão do gate de acesso (prefixo `__Host-` ver `src/lib/auth.ts`). */
export const ACCESS_COOKIE_NAME = "__Host-myfin_access";

/** Validade do cookie de sessão: 30 dias. */
export const ACCESS_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

// --- Limites de importação OFX (defesa contra DoS por arquivo gigante) ---
export const MAX_OFX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_OFX_RECORDS = 10_000;

// --- Rate limiting do login (por IP, em memória) ---
export const LOGIN_MAX_FAILURES = 5;
/** Atraso base do backoff exponencial: 1s, 2s, 4s, 8s… até o teto. */
export const LOGIN_BACKOFF_BASE_MS = 1_000;
export const LOGIN_BACKOFF_MAX_MS = 5 * 60_000;

// --- Ciclo de fatura padrão (cartão sem configuração própria em metadata) ---
export const DEFAULT_CLOSING_DAY = 25;
export const DEFAULT_DUE_DAY = 5;
