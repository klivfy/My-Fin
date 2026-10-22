import { strict as assert } from "node:assert";
import { afterEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { createSessionValue } from "@/lib/access";
import { proxy } from "@/proxy";
import { withEnv } from "@/test/env";

const token = "token-de-teste";
let restore: () => void = () => {};

function request(path: string, init: { cookie?: string; authorization?: string } = {}) {
  const headers = new Headers();
  if (init.cookie) headers.set("cookie", init.cookie);
  if (init.authorization) headers.set("authorization", init.authorization);
  return new NextRequest(`http://localhost${path}`, { headers });
}

const passesThrough = (response: Response) => response.headers.get("x-middleware-next") === "1";

describe("proxy de acesso", () => {
  afterEach(() => restore());

  it("em produção sem APP_ACCESS_TOKEN fica fechado", () => {
    restore = withEnv({ NODE_ENV: "production", APP_ACCESS_TOKEN: undefined });
    assert.equal(proxy(request("/")).status, 503);
    assert.equal(proxy(request("/login")).status, 503);
  });

  it("fora de produção sem token fica aberto", () => {
    restore = withEnv({ NODE_ENV: "development", APP_ACCESS_TOKEN: undefined });
    assert.ok(passesThrough(proxy(request("/"))));
  });

  it("aceita sessão assinada e Bearer com o token", () => {
    restore = withEnv({ NODE_ENV: "production", APP_ACCESS_TOKEN: token });
    assert.ok(passesThrough(proxy(request("/", { cookie: `myfin_access=${createSessionValue(token)}` }))));
    assert.ok(passesThrough(proxy(request("/", { authorization: `Bearer ${token}` }))));
  });

  it("cookie com o token cru (formato antigo) ou forjado volta para o login", () => {
    restore = withEnv({ NODE_ENV: "production", APP_ACCESS_TOKEN: token });
    for (const cookie of [`myfin_access=${token}`, "myfin_access=123.abc", undefined]) {
      const response = proxy(request("/transactions?page=2", { cookie }));
      assert.equal(response.status, 307);
      const location = new URL(response.headers.get("location")!);
      assert.equal(location.pathname, "/login");
      assert.equal(location.searchParams.get("next"), "/transactions?page=2");
    }
  });

  it("login continua acessível sem sessão", () => {
    restore = withEnv({ NODE_ENV: "production", APP_ACCESS_TOKEN: token });
    assert.ok(passesThrough(proxy(request("/login"))));
    assert.ok(passesThrough(proxy(request("/api/login"))));
  });
});
