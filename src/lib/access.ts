import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Gate de acesso por token único (`APP_ACCESS_TOKEN`).
 *
 * O cookie não guarda o token: guarda `emitidoEm.assinatura`, com a
 * assinatura sendo HMAC-SHA256(token, emitidoEm). Vazar o cookie não vaza o
 * token, a sessão expira sozinha e trocar o token invalida todas as sessões.
 * Toda comparação de segredo é feita em tempo constante.
 */

export const ACCESS_COOKIE = "myfin_access";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
/** Tolerância para relógios levemente adiantados entre instâncias. */
const CLOCK_SKEW_SECONDS = 5 * 60;

export function getAccessToken(): string | undefined {
  return process.env.APP_ACCESS_TOKEN || undefined;
}

/** Em produção, sem token o app deve ficar fechado (nunca aberto por omissão). */
export function isAccessGateMisconfigured(): boolean {
  return !getAccessToken() && process.env.NODE_ENV === "production";
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/** Compara o token informado com o configurado sem vazar tempo nem tamanho. */
export function tokenMatches(secret: string, candidate: string | null | undefined): boolean {
  if (!candidate) return false;
  return timingSafeEqual(sha256(secret), sha256(candidate));
}

function sign(secret: string, issuedAt: number): Buffer {
  return createHmac("sha256", secret).update(`myfin-session:${issuedAt}`).digest();
}

export function createSessionValue(secret: string, nowMs: number = Date.now()): string {
  const issuedAt = Math.floor(nowMs / 1000);
  return `${issuedAt}.${sign(secret, issuedAt).toString("base64url")}`;
}

export function verifySessionValue(
  secret: string,
  value: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!value) return false;
  const match = /^(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(value);
  if (!match) return false;

  const issuedAt = Number(match[1]);
  const now = Math.floor(nowMs / 1000);
  if (issuedAt > now + CLOCK_SKEW_SECONDS) return false;
  if (now - issuedAt > SESSION_MAX_AGE_SECONDS) return false;

  const expected = sign(secret, issuedAt);
  const received = Buffer.from(match[2], "base64url");
  return received.length === expected.length && timingSafeEqual(received, expected);
}
