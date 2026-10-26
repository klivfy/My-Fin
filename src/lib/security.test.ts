import { describe, expect, it } from "vitest";
import { deriveSessionToken, isValidAccessCredential, safeCompareSecret } from "./security";

describe("safeCompareSecret", () => {
  it("retorna true para valores idênticos e false para diferentes", () => {
    expect(safeCompareSecret("segredo", "segredo")).toBe(true);
    expect(safeCompareSecret("segredo", "outro")).toBe(false);
  });

  it("não vaza comprimento: compara hashes de tamanho fixo", () => {
    expect(safeCompareSecret("a", "a".repeat(1000))).toBe(false);
    expect(safeCompareSecret("", "")).toBe(true);
  });
});

describe("deriveSessionToken", () => {
  it("é determinístico e nunca igual ao segredo", () => {
    const t1 = deriveSessionToken("meu-segredo");
    const t2 = deriveSessionToken("meu-segredo");
    expect(t1).toBe(t2);
    expect(t1).not.toBe("meu-segredo");
    expect(t1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("segredos diferentes produzem tokens diferentes", () => {
    expect(deriveSessionToken("a")).not.toBe(deriveSessionToken("b"));
  });
});

describe("isValidAccessCredential", () => {
  it("sem APP_ACCESS_TOKEN o gate está aberto", () => {
    expect(isValidAccessCredential(undefined, undefined)).toBe(true);
    expect(isValidAccessCredential("qualquer", undefined)).toBe(true);
  });

  it("aceita o token de sessão derivado", () => {
    const session = deriveSessionToken("segredo");
    expect(isValidAccessCredential(session, "segredo")).toBe(true);
  });

  it("aceita o segredo puro (****** automação)", () => {
    expect(isValidAccessCredential("segredo", "segredo")).toBe(true);
  });

  it("rejeita valor ausente ou incorreto", () => {
    expect(isValidAccessCredential(undefined, "segredo")).toBe(false);
    expect(isValidAccessCredential("errado", "segredo")).toBe(false);
  });
});
