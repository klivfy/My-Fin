import { z } from "zod";

/**
 * Resultado de Server Action para erros ESPERADOS (validação, regra de
 * negócio). Em produção o Next/React não repassa ao navegador a mensagem
 * de erros lançados numa Server Action (vira "Minified React error #441"),
 * então mensagens para o usuário precisam voltar como valor de retorno.
 * Erros inesperados continuam sendo lançados: o cliente vê uma mensagem
 * genérica e o detalhe fica só no log do servidor.
 */
export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

/** Erro de regra de negócio cuja mensagem pode ser mostrada ao usuário. */
export class UserFacingError extends Error {}

export async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { ok: false, error: error.issues[0]?.message ?? "Dados inválidos." };
    }
    if (error instanceof UserFacingError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}
