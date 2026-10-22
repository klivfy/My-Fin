import { strict as assert } from "node:assert";
import { afterEach, describe, it } from "node:test";
import { verifySessionValue } from "@/lib/access";
import { withEnv } from "@/test/env";
import { POST } from "./route";

const token = "token-de-teste";
let restore: () => void = () => {};

function login(body: unknown, ip: string) {
  return POST(
    new Request("http://localhost/api/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-nf-client-connection-ip": ip },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/login", () => {
  afterEach(() => restore());

  it("em produção sem APP_ACCESS_TOKEN responde 503", async () => {
    restore = withEnv({ NODE_ENV: "production", APP_ACCESS_TOKEN: undefined });
    assert.equal((await login({ token: "x" }, "10.0.0.1")).status, 503);
  });

  it("token certo grava cookie assinado, sem o token", async () => {
    restore = withEnv({ NODE_ENV: "production", APP_ACCESS_TOKEN: token });
    const response = await login({ token }, "10.0.0.2");
    assert.equal(response.status, 200);
    const cookie = response.headers.get("set-cookie") ?? "";
    const value = /myfin_access=([^;]+)/.exec(cookie)?.[1];
    assert.ok(value && !value.includes(token));
    assert.equal(verifySessionValue(token, decodeURIComponent(value)), true);
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /Secure/i);
  });

  it("token errado responde 401", async () => {
    restore = withEnv({ NODE_ENV: "production", APP_ACCESS_TOKEN: token });
    assert.equal((await login({ token: "errado" }, "10.0.0.3")).status, 401);
    assert.equal((await login({ token: 123 }, "10.0.0.3")).status, 401);
    assert.equal((await login(null, "10.0.0.3")).status, 401);
  });

  it("bloqueia o IP depois de 10 tentativas", async () => {
    restore = withEnv({ NODE_ENV: "production", APP_ACCESS_TOKEN: token });
    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) statuses.push((await login({ token: "errado" }, "10.0.0.4")).status);
    assert.deepEqual(statuses, [...Array(10).fill(401), 429]);
    const blocked = await login({ token }, "10.0.0.4");
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("retry-after")) > 0);
    // Outro IP não é afetado.
    assert.equal((await login({ token }, "10.0.0.5")).status, 200);
  });
});
