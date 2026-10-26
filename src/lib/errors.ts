/**
 * Erro de domínio: representa uma violação de regra de negócio ou de
 * validação cuja mensagem é segura para exibir ao usuário (ex.: "A conta de
 * origem e destino não podem ser a mesma.").
 *
 * A UI pode distinguir `DomainError` (mensagem amigável esperada) de falhas
 * inesperadas de infraestrutura (Prisma, rede, bug) — que devem ser
 * reportadas genericamente e logadas em detalhe no servidor.
 */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}

/** Mensagem genérica segura para persistir/exibir quando o erro não é de domínio. */
export function safeErrorMessage(error: unknown, fallback = "Erro interno ao processar a operação."): string {
  return error instanceof DomainError ? error.message : fallback;
}
