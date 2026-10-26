/**
 * Instrumentação do Next.js: roda uma vez no boot do servidor Node.
 * Usada para a verificação de ambiente (aviso de produção sem token).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { checkEnvOnBoot } = await import("@/lib/env");
    checkEnvOnBoot();
  }
}
