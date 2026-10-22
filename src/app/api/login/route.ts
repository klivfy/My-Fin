import { NextResponse } from "next/server";
import {
  ACCESS_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  createSessionValue,
  getAccessToken,
  isAccessGateMisconfigured,
  tokenMatches,
} from "@/lib/access";
import { createRateLimiter } from "@/lib/rate-limit";

/**
 * 10 tentativas por IP a cada 15 minutos. Em memória, por instância: veja
 * a limitação descrita em src/lib/rate-limit.ts.
 */
const loginLimiter = createRateLimiter({ limit: 10, windowMs: 15 * 60 * 1000, maxKeys: 10_000 });

function clientIp(request: Request): string {
  // Netlify grava o IP real do cliente neste cabeçalho; os demais são
  // fallback para outros ambientes.
  const netlifyIp = request.headers.get("x-nf-client-connection-ip");
  if (netlifyIp) return netlifyIp.trim();
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

export async function POST(request: Request) {
  if (isAccessGateMisconfigured()) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  const requiredToken = getAccessToken();
  if (!requiredToken) {
    return NextResponse.json({ ok: true });
  }

  const ip = clientIp(request);
  const limit = loginLimiter.consume(ip);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "too_many_attempts" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const body = (await request.json().catch(() => null)) as { token?: unknown } | null;
  const token = typeof body?.token === "string" ? body.token : null;
  if (!tokenMatches(requiredToken, token)) {
    return NextResponse.json({ error: "invalid" }, { status: 401 });
  }

  loginLimiter.reset(ip);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ACCESS_COOKIE, createSessionValue(requiredToken), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
