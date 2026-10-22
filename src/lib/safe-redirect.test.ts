import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { safeNextPath } from "@/lib/safe-redirect";

describe("destino pós-login", () => {
  it("aceita caminho interno", () => {
    assert.equal(safeNextPath("/transactions?page=2"), "/transactions?page=2");
    assert.equal(safeNextPath("/"), "/");
  });

  it("recusa destino externo ou ambíguo", () => {
    for (const value of [
      null,
      "",
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "/\\/evil.example",
      "javascript:alert(1)",
      "/\nevil",
      "evil.example/path",
    ]) {
      assert.equal(safeNextPath(value), "/", String(value));
    }
  });
});
