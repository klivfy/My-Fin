import crypto from "node:crypto";

/**
 * Cifra simétrica para segredos guardados no banco (ex.: o identificador de
 * uma conexão do Open Finance). AES-256-GCM com IV aleatório de 12 bytes:
 * a tag de autenticação faz qualquer alteração no texto cifrado falhar na
 * leitura, em vez de devolver lixo.
 *
 * Formato: `v1.<iv>.<tag>.<cifrado>` em base64url. O prefixo de versão
 * permite trocar o algoritmo no futuro sem ambiguidade.
 *
 * A chave vem de `ENCRYPTION_KEY` (32 bytes em base64), configurada só nas
 * variáveis de ambiente da Vercel. Gere com:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 */

const VERSION = "v1";
const IV_BYTES = 12;
const KEY_BYTES = 32;

export class SecretBoxError extends Error {}

export function parseKey(raw: string | undefined): Buffer {
  if (!raw) throw new SecretBoxError("ENCRYPTION_KEY não configurada.");
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new SecretBoxError(`ENCRYPTION_KEY precisa ter ${KEY_BYTES} bytes em base64 (tem ${key.length}).`);
  }
  return key;
}

function envKey(): Buffer {
  return parseKey(process.env.ENCRYPTION_KEY);
}

export function seal(plaintext: string, key: Buffer = envKey()): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, encrypted].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

export function open(sealed: string, key: Buffer = envKey()): string {
  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new SecretBoxError("Formato de segredo cifrado desconhecido.");
  }
  const [, iv, tag, encrypted] = parts.map((p) => Buffer.from(p, "base64url"));
  if (iv.length !== IV_BYTES || tag.length !== 16) {
    throw new SecretBoxError("Segredo cifrado corrompido.");
  }
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch {
    throw new SecretBoxError("Não foi possível decifrar: chave errada ou dado alterado.");
  }
}
