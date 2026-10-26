import { NextRequest, NextResponse } from "next/server";
import { ACCESS_COOKIE_MAX_AGE_SECONDS, ACCESS_COOKIE_NAME } from "@/lib/constants";
import { deriveSessionToken, safeCompareSecret } from "@/lib/security";
import { checkLoginAllowed, recordLoginFailure, recordLoginSuccess } from "@/lib/rate-limit";

function clientIp(request: NextRequest): string {
  // Netlify/proxies em geral: x-forwarded-for (primeiro IP da lista).
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(request: NextRequest) {
  const requiredToken = process.env.APP_ACCESS_TOKEN;
  if (!requiredToken) {
    return NextResponse.json({ ok: true });
  }

  const ip = clientIp(request);
  const gate = checkLoginAllowed(ip);
  if (!gate.allowed) {
    return NextResponse.json(
      { error: "too_many_attempts", retryAfterSeconds: gate.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSeconds) } },
    );
  }

  const body = (await request.json().catch(() => null)) as { token?: string } | null;
  if (!body?.token || !safeCompareSecret(body.token, requiredToken)) {
    const result = recordLoginFailure(ip);
    if (!result.allowed) {
      return NextResponse.json(
        { error: "too_many_attempts", retryAfterSeconds: result.retryAfterSeconds },
        { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } },
      );
    }
    return NextResponse.json({ error: "invalid" }, { status: 401 });
  }

  recordLoginSuccess(ip);

  // Cookie de sessão com token derivado (HMAC do segredo): o segredo real
  // nunca fica armazenado no navegador. Prefixo `__Host-` exige secure +
  // path=/ + sem Domain — o navegador reforça o escopo por nós.
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ACCESS_COOKIE_NAME, deriveSessionToken(requiredToken), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ACCESS_COOKIE_MAX_AGE_SECONDS,
  });
  return response;
}
