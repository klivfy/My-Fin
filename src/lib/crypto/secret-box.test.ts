import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { open, parseKey, seal, SecretBoxError } from "./secret-box";

// Chaves geradas na hora: nenhum segredo fixo no repositório.
const key = crypto.randomBytes(32);
const otherKey = crypto.randomBytes(32);

describe("secret-box", () => {
  it("faz ida e volta com acentos e emoji", () => {
    const text = "conexão-teste-çãé-🔒";
    expect(open(seal(text, key), key)).toBe(text);
  });

  it("gera um cifrado diferente a cada chamada (IV aleatório)", () => {
    expect(seal("mesmo texto", key)).not.toBe(seal("mesmo texto", key));
  });

  it("não deixa o texto claro aparecer no cifrado", () => {
    expect(seal("item-abc-123", key)).not.toContain("item-abc-123");
  });

  it("recusa chave errada", () => {
    expect(() => open(seal("x", key), otherKey)).toThrow(SecretBoxError);
  });

  it("recusa cifrado alterado (tag GCM)", () => {
    const parts = seal("valor", key).split(".");
    const tampered = Buffer.from(parts[3], "base64url");
    tampered[0] ^= 0xff;
    parts[3] = tampered.toString("base64url");
    expect(() => open(parts.join("."), key)).toThrow(/decifrar/);
  });

  it("recusa formato desconhecido", () => {
    expect(() => open("v0.a.b.c", key)).toThrow(/Formato/);
    expect(() => open("lixo", key)).toThrow(SecretBoxError);
  });

  it("valida o tamanho da chave do ambiente", () => {
    expect(() => parseKey(undefined)).toThrow(/não configurada/);
    expect(() => parseKey(Buffer.alloc(16).toString("base64"))).toThrow(/32 bytes/);
    expect(parseKey(key.toString("base64")).equals(key)).toBe(true);
  });
});
