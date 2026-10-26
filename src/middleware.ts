import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ACCESS_COOKIE_NAME } from "@/lib/constants";
import { isValidAccessCredential } from "@/lib/security";

/**
 * Gate opcional para deploy público.
 *
 * Sem `APP_ACCESS_TOKEN` o app permanece aberto (uso local / rede privada).
 * Com o token configurado, exige o cookie de sessão `__Host-myfin_access`
 * (token derivado por HMAC — ver `src/lib/security.ts`) ou header
 * `Authorization: ****** Suficiente para um PFM pessoal sem
 * OAuth completo. Não exponha o site na internet sem definir esse token.
 *
 * Nota: a defesa em profundidade das Server Actions fica em
 * `src/lib/auth.ts` (`assertAuthorized`), para o caso de este matcher
 * deixar passar alguma rota nova.
 */
export function middleware(request: NextRequest) {
  const requiredToken = process.env.APP_ACCESS_TOKEN;
  if (!requiredToken) return NextResponse.next();

  const cookie = request.cookies.get(ACCESS_COOKIE_NAME)?.value;
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (isValidAccessCredential(cookie, requiredToken) || isValidAccessCredential(bearer, requiredToken)) {
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
