import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Utilitários do gate de acesso por token (`APP_ACCESS_TOKEN`).
 *
 * Modelo: app single-tenant. Quando o token está configurado, o usuário faz
 * login uma vez e recebe um cookie `__Host-` cujo valor é um token de
 * sessão derivado por HMAC-SHA256(segredo, "myfin-session-v1") — o segredo
 * em si nunca é persistido no navegador. A verificação usa
 * `crypto.timingSafeEqual` sobre os hashes SHA-256 dos dois lados, o que
 * elimina a vulnerabilidade a timing attack da comparação `===` anterior
 * (o hash prévio também garante buffers de tamanho idêntico, exigência do
 * timingSafeEqual).
 */

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Compara dois segredos em tempo constante (via hash, ignora comprimento). */
export function safeCompareSecret(a: string, b: string): boolean {
  return timingSafeEqual(sha256(a), sha256(b));
}

/** Deriva o token de sessão determinístico a partir do segredo configurado. */
export function deriveSessionToken(secret: string): string {
  return createHmac("sha256", secret).update("myfin-session-v1").digest("hex");
}

/**
 * Verifica um valor recebido (cookie ou Bearer) contra o segredo do
 * ambiente. Aceita o token de sessão derivado ou o próprio segredo (este
 * último para automação via `Authorization: Bearer`). Retorna `true`
 * quando o gate está desligado (sem APP_ACCESS_TOKEN).
 */
export function isValidAccessCredential(
  presentedValue: string | undefined,
  requiredToken: string | undefined,
): boolean {
  if (!requiredToken) return true;
  if (!presentedValue) return false;
  return (
    safeCompareSecret(presentedValue, deriveSessionToken(requiredToken)) ||
    safeCompareSecret(presentedValue, requiredToken)
  );
}
