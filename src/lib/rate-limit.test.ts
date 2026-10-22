import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { createRateLimiter } from "@/lib/rate-limit";

describe("limitador em memória", () => {
  it("bloqueia depois do limite e libera na janela seguinte", () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000, maxKeys: 100 });
    const t0 = 1_000_000;
    assert.deepEqual(
      [1, 2, 3, 4].map(() => limiter.consume("1.2.3.4", t0).allowed),
      [true, true, true, false],
    );
    assert.equal(limiter.consume("1.2.3.4", t0 + 30_000).retryAfterSeconds, 30);
    assert.equal(limiter.consume("5.6.7.8", t0).allowed, true);
    assert.equal(limiter.consume("1.2.3.4", t0 + 60_000).allowed, true);
  });

  it("reset libera a chave", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 100 });
    limiter.consume("a", 0);
    assert.equal(limiter.consume("a", 0).allowed, false);
    limiter.reset("a");
    assert.equal(limiter.consume("a", 0).allowed, true);
  });

  it("não passa do teto de chaves", () => {
    const limiter = createRateLimiter({ limit: 5, windowMs: 60_000, maxKeys: 50 });
    for (let i = 0; i < 1000; i += 1) limiter.consume(`ip-${i}`, i);
    assert.ok(limiter.size <= 50);
    // As chaves mais recentes continuam contadas.
    for (let i = 0; i < 5; i += 1) limiter.consume("ip-999", 1000);
    assert.equal(limiter.consume("ip-999", 1000).allowed, false);
  });
});
