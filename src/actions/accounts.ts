"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { decimalToDb, toDecimal } from "@/lib/money";
import { revalidateDashboard } from "@/lib/revalidate";
import { assertAuthorized } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";

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
