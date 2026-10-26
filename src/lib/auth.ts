import { cookies } from "next/headers";
import { ACCESS_COOKIE_NAME } from "./constants";
import { isValidAccessCredential } from "./security";

/**
 * Defesa em profundidade das Server Actions.
 *
 * O middleware (`src/middleware.ts`) já barra requisições sem credencial,
 * mas matcher de middleware é configuração frágil (rota nova esquecida,
 * caminho de `/_next/data`, proxy mal configurado). Por isso TODA Server
 * Action que toca em dados financeiros chama `assertAuthorized()` como
 * primeira instrução: se `APP_ACCESS_TOKEN` estiver definido e o cookie de
 * sessão não conferir, a ação falha antes de qualquer lógica de negócio.
 *
 * Fora do ciclo de requisição Next (ex.: `prisma/seed.ts`), `cookies()`
 * lança exceção — tratada como "sem contexto de request": a seed roda no
 * mesmo processo privilegiado do servidor e não deve ser bloqueada.
 */
export async function assertAuthorized(): Promise<void> {
  const requiredToken = process.env.APP_ACCESS_TOKEN;
  if (!requiredToken) return;

  let cookieValue: string | undefined;
  try {
    const store = await cookies();
    cookieValue = store.get(ACCESS_COOKIE_NAME)?.value;
  } catch {
    // Sem contexto de request (seed/script): não há o que validar aqui.
    return;
  }

  if (!isValidAccessCredential(cookieValue, requiredToken)) {
    throw new Error("Não autorizado.");
  }
}
