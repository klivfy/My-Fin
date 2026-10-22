import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { SESSION_MAX_AGE_SECONDS, createSessionValue, tokenMatches, verifySessionValue } from "@/lib/access";

const secret = "segredo-de-teste";

describe("sessão de acesso", () => {
  it("cookie não contém o token e é aceito enquanto válido", () => {
    const now = Date.UTC(2026, 0, 1);
    const value = createSessionValue(secret, now);
    assert.ok(!value.includes(secret));
    assert.equal(verifySessionValue(secret, value, now), true);
    assert.equal(verifySessionValue(secret, value, now + (SESSION_MAX_AGE_SECONDS - 60) * 1000), true);
  });

  it("expira depois do prazo", () => {
    const now = Date.UTC(2026, 0, 1);
    const value = createSessionValue(secret, now);
    assert.equal(verifySessionValue(secret, value, now + (SESSION_MAX_AGE_SECONDS + 1) * 1000), false);
  });

  it("recusa emissão no futuro, assinatura de outro token e valor adulterado", () => {
    const now = Date.UTC(2026, 0, 1);
    assert.equal(verifySessionValue(secret, createSessionValue(secret, now + 3600_000), now), false);
    assert.equal(verifySessionValue(secret, createSessionValue("outro", now), now), false);
    const [issuedAt, sig] = createSessionValue(secret, now).split(".");
    assert.equal(verifySessionValue(secret, `${Number(issuedAt) + 1}.${sig}`, now), false);
    assert.equal(verifySessionValue(secret, secret, now), false);
    assert.equal(verifySessionValue(secret, "", now), false);
    assert.equal(verifySessionValue(secret, undefined, now), false);
  });

  it("compara o token informado", () => {
    assert.equal(tokenMatches(secret, secret), true);
    assert.equal(tokenMatches(secret, `${secret}x`), false);
    assert.equal(tokenMatches(secret, ""), false);
    assert.equal(tokenMatches(secret, null), false);
  });
});
