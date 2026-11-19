import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Gate de acesso.
 *
 * Local, sem `APP_ACCESS_TOKEN`, o app fica aberto. Com o token configurado,
 * exige cookie `myfin_access` (ou Bearer) igual ao segredo: suficiente para
 * um PFM pessoal sem OAuth completo.
 *
 * Na Vercel (`VERCEL=1`) toda URL de deploy é pública, então falta de token
 * é erro de configuração: responde 503 em vez de abrir os dados financeiros.
 */
export function proxy(request: NextRequest) {
  const requiredToken = process.env.APP_ACCESS_TOKEN;
  if (!requiredToken) {
    if (process.env.VERCEL) {
      return new NextResponse("APP_ACCESS_TOKEN não configurado neste ambiente da Vercel.", {
        status: 503,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    return NextResponse.next();
  }

  const cookie = request.cookies.get("myfin_access")?.value;
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (cookie === requiredToken || bearer === requiredToken) {
    return NextResponse.next();
  }

  if (request.nextUrl.pathname === "/login" || request.nextUrl.pathname === "/api/login") {
    return NextResponse.next();
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
