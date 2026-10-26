import { LOGIN_BACKOFF_BASE_MS, LOGIN_BACKOFF_MAX_MS, LOGIN_MAX_FAILURES } from "./constants";

/**
 * Rate limiter em memória para o endpoint de login (brute force do token).
 *
 * Modelo: single-tenant, processo único — um Map em memória é suficiente
 * (serverless efêmero apenas reduz a janela de proteção, o que é aceitável
 * para um PFM pessoal; o backoff reinicia por instância).
 *
 * Regra: após `LOGIN_MAX_FAILURES` falhas consecutivas, o IP fica bloqueado
 * por um período com backoff exponencial (1s, 2s, 4s … até 5 min). Sucesso
 * zera o contador. Entradas expiradas são varridas oportunisticamente para
 * não vazar memória.
 */

interface AttemptState {
  failures: number;
  blockedUntil: number;
}

const attempts = new Map<string, AttemptState>();
let lastSweep = Date.now();

function sweepExpired(now: number): void {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, state] of attempts) {
    if (state.blockedUntil <= now && state.failures === 0) attempts.delete(key);
  }
}

export interface LoginRateLimitResult {
  allowed: boolean;
  /** Segundos até a próxima tentativa ser permitida (quando bloqueado). */
  retryAfterSeconds: number;
}

/** Verifica se o IP pode tentar agora (não registra falha). */
export function checkLoginAllowed(key: string): LoginRateLimitResult {
  const now = Date.now();
  sweepExpired(now);
  const state = attempts.get(key);
  if (state && state.blockedUntil > now) {
    return { allowed: false, retryAfterSeconds: Math.ceil((state.blockedUntil - now) / 1000) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Registra uma falha de login; aplica bloqueio com backoff exponencial. */
export function recordLoginFailure(key: string): LoginRateLimitResult {
  const now = Date.now();
  const state = attempts.get(key) ?? { failures: 0, blockedUntil: 0 };
  state.failures += 1;

  if (state.failures >= LOGIN_MAX_FAILURES) {
    const exponent = Math.min(state.failures - LOGIN_MAX_FAILURES, 10);
    const delay = Math.min(LOGIN_BACKOFF_BASE_MS * 2 ** exponent, LOGIN_BACKOFF_MAX_MS);
    state.blockedUntil = now + delay;
  }

  attempts.set(key, state);
  return checkLoginAllowed(key);
}

/** Zera o estado do IP após login bem-sucedido. */
export function recordLoginSuccess(key: string): void {
  attempts.delete(key);
}
