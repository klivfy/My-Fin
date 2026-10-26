/**
 * Logger estruturado (JSON por linha) para as Server Actions e jobs.
 *
 * Por que não console.log solto: em produção (Netlify Functions) os logs
 * vão para um agregador — linhas JSON permitem filtrar por `action`,
 * `entityId` ou `syncLogId` e correlacionar uma operação de ponta a ponta.
 * Em desenvolvimento, o formato permanece legível o bastante no terminal.
 */

export type LogLevel = "info" | "warn" | "error";

export interface LogContext {
  /** Nome da Server Action ou job (ex.: "transactions.create"). */
  action: string;
  /** Correlação com a rodada de ingestão, quando houver. */
  syncLogId?: string;
  entityType?: string;
  entityId?: string;
  /** Campos extras JSON-safe. */
  [key: string]: unknown;
}

function emit(level: LogLevel, context: LogContext, message: string, error?: unknown): void {
  const line = {
    level,
    msg: message,
    at: new Date().toISOString(),
    ...context,
    ...(error instanceof Error ? { error: error.message, stack: error.stack } : error ? { error: String(error) } : {}),
  };
  const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
  sink(JSON.stringify(line));
}

export const logger = {
  info: (context: LogContext, message: string) => emit("info", context, message),
  warn: (context: LogContext, message: string) => emit("warn", context, message),
  error: (context: LogContext, message: string, error?: unknown) => emit("error", context, message, error),
};
