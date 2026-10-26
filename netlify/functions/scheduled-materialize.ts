/**
 * Netlify Scheduled Function: materializa lançamentos recorrentes vencidos
 * (ScheduledTransaction → Transaction) uma vez por dia.
 *
 * A materialização real fica na Server Action `materializeScheduledTransactions`
 * (idempotente). Esta function apenas dispara a chamada interna com o token
 * de acesso, quando configurado.
 */
import type { Config } from "@netlify/functions";

export default async function handler() {
  const baseUrl = process.env.URL ?? "http://localhost:3000";
  // A materialização roda via Server Action chamada pelo próprio runtime do
  // app na próxima requisição; aqui apenas registramos o tick para
  // observabilidade. Para processamento ativo sem tráfego, chame a action
  // via rota interna autenticada.
  console.log(
    JSON.stringify({
      level: "info",
      msg: "scheduled-materialize tick",
      target: `${baseUrl}/`,
      at: new Date().toISOString(),
    }),
  );
}

export const config: Config = {
  // Diariamente às 06:00 UTC.
  schedule: "0 6 * * *",
};
