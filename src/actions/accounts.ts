"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { decimalToDb, moneySchema, toDecimal } from "@/lib/money";
import { revalidateDashboard } from "@/lib/revalidate";
import { assertAuthorized } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { accountMetadataSchema } from "@/lib/account-metadata";
import { DomainError } from "@/lib/errors";

// ----------------------------------------------------------------------------
// CRUD de contas
// ----------------------------------------------------------------------------

const accountTypeSchema = z.enum(["CHECKING", "SAVINGS", "CREDIT_CARD", "INVESTMENT", "CASH"]);

const createAccountSchema = z.object({
  name: z.string().trim().min(1, "Nome obrigatório."),
  type: accountTypeSchema,
  initialBalance: moneySchema.optional(),
  creditLimit: moneySchema.optional(),
  closingDay: z.number().int().min(1).max(28).optional(),
  dueDay: z.number().int().min(1).max(28).optional(),
});

const updateAccountSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).optional(),
  creditLimit: moneySchema.nullable().optional(),
  closingDay: z.number().int().min(1).max(28).nullable().optional(),
  dueDay: z.number().int().min(1).max(28).nullable().optional(),
});

export type CreateAccountInput = z.input<typeof createAccountSchema>;
export type UpdateAccountInput = z.input<typeof updateAccountSchema>;

/**
 * Cria uma conta. `initialBalance` (padrão 0) é o saldo de abertura —
 * `currentBalance` materializado começa igual a ele. Para CREDIT_CARD, o
 * ciclo de fatura (closingDay/dueDay) e o limite ficam em `metadata`,
 * validados pelo `accountMetadataSchema`.
 */
export async function createAccount(input: CreateAccountInput) {
  await assertAuthorized();
  const parsed = createAccountSchema.parse(input);

  const metadata = accountMetadataSchema.parse({
    creditLimit: parsed.creditLimit?.toFixed(2),
    closingDay: parsed.closingDay,
    dueDay: parsed.dueDay,
  });
  const hasMetadata = Object.values(metadata).some((v) => v !== undefined);

  const account = await prisma.$transaction(async (tx) => {
    const created = await tx.account.create({
      data: {
        name: parsed.name,
        type: parsed.type,
        initialBalance: decimalToDb(parsed.initialBalance ?? toDecimal(0)),
        currentBalance: decimalToDb(parsed.initialBalance ?? toDecimal(0)),
        metadata: hasMetadata ? metadata : undefined,
      },
    });
    await recordAudit(tx, {
      action: "account.create",
      entityType: "Account",
      entityId: created.id,
      payload: { name: created.name, type: created.type },
    });
    return created;
  });

  revalidateDashboard();
  return account;
}

/** Atualiza nome e metadata (limite/ciclo de fatura) de uma conta. */
export async function updateAccount(input: UpdateAccountInput) {
  await assertAuthorized();
  const parsed = updateAccountSchema.parse(input);

  const account = await prisma.$transaction(async (tx) => {
    const existing = await tx.account.findUniqueOrThrow({
      where: { id: parsed.id },
      select: { metadata: true },
    });

    const previous = accountMetadataSchema.parse(
      existing.metadata && typeof existing.metadata === "object" ? existing.metadata : {},
    );
    const nextMetadata = accountMetadataSchema.parse({
      creditLimit:
        parsed.creditLimit === null
          ? undefined
          : (parsed.creditLimit?.toFixed(2) ?? previous.creditLimit),
      closingDay: parsed.closingDay === null ? undefined : (parsed.closingDay ?? previous.closingDay),
      dueDay: parsed.dueDay === null ? undefined : (parsed.dueDay ?? previous.dueDay),
    });
    const hasMetadata = Object.values(nextMetadata).some((v) => v !== undefined);

    const updated = await tx.account.update({
      where: { id: parsed.id },
      data: {
        name: parsed.name ?? undefined,
        metadata: hasMetadata ? nextMetadata : { set: null },
      },
    });

    await recordAudit(tx, {
      action: "account.update",
      entityType: "Account",
      entityId: updated.id,
      payload: { name: updated.name },
    });
    return updated;
  });

  revalidateDashboard();
  return account;
}

/**
 * Desativa uma conta (soft delete via `isActive`): some da UI e dos
 * relatórios, mas preserva o histórico. Recusar quando há saldo diferente
 * de zero — desativar com saldo criaria patrimônio fantasma escondido.
 */
export async function deactivateAccount(input: { id: string }) {
  await assertAuthorized();
  const { id } = z.object({ id: z.string().uuid() }).parse(input);

  await prisma.$transaction(async (tx) => {
    const account = await tx.account.findUniqueOrThrow({
      where: { id },
      select: { currentBalance: true, isActive: true },
    });
    if (!account.isActive) {
      throw new DomainError("Esta conta já está inativa.");
    }
    if (!toDecimal(account.currentBalance.toString()).isZero()) {
      throw new DomainError(
        "Zere o saldo da conta (via transferência ou ajuste) antes de desativá-la.",
      );
    }
    await tx.account.update({ where: { id }, data: { isActive: false } });
    await recordAudit(tx, {
      action: "account.deactivate",
      entityType: "Account",
      entityId: id,
    });
  });

  revalidateDashboard();
}


export interface BalanceAuditResult {
  accountId: string;
  stored: string;
  expected: string;
  drift: string;
  /** `true` quando o saldo materializado foi corrigido para o valor calculado. */
  corrected: boolean;
}

/**
 * Auditoria de saldo: recalcula `initialBalance + SUM(transactions.amount)`
 * e compara com o `currentBalance` materializado. Como o saldo é mantido por
 * ajustes de delta em cada Server Action, qualquer bug acumularia
 * silenciosamente — esta ação expõe o desvio e, opcionalmente, corrige.
 *
 * Roda dentro de uma única transação de banco com recálculo + correção
 * atômicos, e registra o resultado no AuditLog.
 */
export async function auditAccountBalance(input: {
  accountId: string;
  /** Quando `true`, corrige o saldo materializado para o valor calculado. */
  fix?: boolean;
}): Promise<BalanceAuditResult> {
  await assertAuthorized();
  const { accountId, fix } = z
    .object({ accountId: z.string().uuid(), fix: z.boolean().optional() })
    .parse(input);

  const result = await prisma.$transaction(async (tx) => {
    const account = await tx.account.findUniqueOrThrow({
      where: { id: accountId },
      select: { initialBalance: true, currentBalance: true },
    });

    const sum = await tx.transaction.aggregate({
      where: { accountId },
      _sum: { amount: true },
    });

    const expected = toDecimal(account.initialBalance.toString()).plus(
      sum._sum.amount?.toString() ?? "0",
    );
    const stored = toDecimal(account.currentBalance.toString());
    const drift = stored.minus(expected);
    const corrected = fix === true && !drift.isZero();

    if (corrected) {
      await tx.account.update({
        where: { id: accountId },
        data: { currentBalance: decimalToDb(expected) },
      });
    }

    await recordAudit(tx, {
      action: "account.balanceAudit",
      entityType: "Account",
      entityId: accountId,
      payload: {
        stored: stored.toFixed(2),
        expected: expected.toFixed(2),
        drift: drift.toFixed(2),
        corrected,
      },
    });

    return {
      accountId,
      stored: stored.toFixed(2),
      expected: expected.toFixed(2),
      drift: drift.toFixed(2),
      corrected,
    };
  });

  if (result.corrected) revalidateDashboard();
  return result;
}

/** Versão em lote: audita todas as contas ativas (corrigindo se `fix`). */
export async function auditAllAccountBalances(input: { fix?: boolean } = {}): Promise<BalanceAuditResult[]> {
  await assertAuthorized();
  const accounts = await prisma.account.findMany({
    where: { isActive: true },
    select: { id: true },
  });
  const results: BalanceAuditResult[] = [];
  // Sequencial de propósito: cada auditoria é uma transação própria e o
  // volume de contas de um PFM pessoal é pequeno.
  for (const account of accounts) {
    results.push(await auditAccountBalance({ accountId: account.id, fix: input.fix }));
  }
  return results;
}
