import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  ACCESS_COOKIE,
  getAccessToken,
  isAccessGateMisconfigured,
  tokenMatches,
  verifySessionValue,
} from "@/lib/access";

const PUBLIC_PATHS = new Set(["/login", "/api/login"]);

/**
 * Gate de acesso do app (Proxy, antigo Middleware).
 *
 * Com `APP_ACCESS_TOKEN` definido, exige o cookie de sessão assinado
 * emitido por `/api/login` (ou `Authorization: Bearer <token>`). Sem o
 * token, o app só fica aberto fora de produção (uso local); em produção
 * responde 503 em vez de expor tudo por esquecimento da variável.
 */
export function proxy(request: NextRequest) {
  if (isAccessGateMisconfigured()) {
    return new NextResponse("Acesso não configurado (APP_ACCESS_TOKEN ausente).", { status: 503 });
  }

  const requiredToken = getAccessToken();
  if (!requiredToken) return NextResponse.next();

  const session = request.cookies.get(ACCESS_COOKIE)?.value;
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (verifySessionValue(requiredToken, session) || tokenMatches(requiredToken, bearer)) {
    return NextResponse.next();
  }

  if (PUBLIC_PATHS.has(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  loginUrl.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
