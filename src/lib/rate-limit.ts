/**
 * Limitador de tentativas em memória, por janela fixa.
 *
 * Limitação conhecida: o estado vive na memória de cada instância. No
 * Netlify cada função serverless tem a sua, e um cold start zera a
 * contagem, então o teto efetivo é "limite x instâncias ativas". Ainda
 * assim corta força bruta de uma origem só. Para um limite global seria
 * preciso um store compartilhado (Redis/Upstash, Netlify Blobs etc.).
 *
 * `maxKeys` impede que muitas origens diferentes façam o mapa crescer sem
 * limite: primeiro saem as janelas vencidas, depois as mais antigas.
 */
export interface RateLimiterOptions {
  limit: number;
  windowMs: number;
  maxKeys: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function createRateLimiter({ limit, windowMs, maxKeys }: RateLimiterOptions) {
  const entries = new Map<string, { count: number; resetAt: number }>();

  function makeRoom(now: number) {
    if (entries.size < maxKeys) return;
    for (const [key, entry] of entries) {
      if (entry.resetAt <= now) entries.delete(key);
    }
    // Map preserva a ordem de inserção: o primeiro é o mais antigo.
    while (entries.size >= maxKeys) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  }

  return {
    /** Conta uma tentativa para `key` e diz se ela está dentro do limite. */
    consume(key: string, now: number = Date.now()): RateLimitResult {
      let entry = entries.get(key);
      if (!entry || entry.resetAt <= now) {
        entries.delete(key);
        makeRoom(now);
        entry = { count: 0, resetAt: now + windowMs };
        entries.set(key, entry);
      }
      entry.count += 1;
      return {
        allowed: entry.count <= limit,
        remaining: Math.max(0, limit - entry.count),
        retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
      };
    },
    reset(key: string) {
      entries.delete(key);
    },
    get size() {
      return entries.size;
    },
  };
}
