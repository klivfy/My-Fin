/**
 * Verificações de ambiente executadas uma única vez no boot do servidor
 * (importada pela instrumentação do Next — `src/instrumentation.ts` — e por
 * qualquer entrypoint que queira garantir a checagem).
 */

let bootChecked = false;

/**
 * Avisa (alto e claro) quando o app está em produção sem `APP_ACCESS_TOKEN`:
 * é o cenário "deploy público aberto por esquecimento". Não derruba o boot
 * porque há casos legítimos (rede privada), mas o log precisa ser
 * impossível de ignorar.
 */
export function checkEnvOnBoot(): void {
  if (bootChecked) return;
  bootChecked = true;

  if (process.env.NODE_ENV === "production" && !process.env.APP_ACCESS_TOKEN) {
    console.warn(
      "\n" +
        "╔══════════════════════════════════════════════════════════════════════╗\n" +
        "║  [My-Fin] ATENÇÃO: APP_ACCESS_TOKEN não está definido.               ║\n" +
        "║  O app está ABERTO — qualquer pessoa com a URL tem acesso total aos  ║\n" +
        "║  dados financeiros. Defina APP_ACCESS_TOKEN nas variáveis de         ║\n" +
        "║  ambiente do deploy (Netlify) para exigir login.                     ║\n" +
        "╚══════════════════════════════════════════════════════════════════════╝\n",
    );
  }
}
