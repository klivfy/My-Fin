"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { decimalToDb, moneySchema, toDecimal } from "@/lib/money";
import { computeReconciliationHash, normalizeDescription } from "@/lib/financial-engine/reconciliation";
import { revalidateDashboard } from "@/lib/revalidate";
import { assertAuthorized } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";

const upsertScheduledSchema = z.object({
  accountId: z.string().uuid(),
  categoryId: z.string().uuid().nullable().optional(),
  amount: moneySchema,
  type: z.enum(["INCOME", "EXPENSE"]),
  description: z.string().trim().min(1),
  frequency: z.enum(["WEEKLY", "MONTHLY"]),
  /** MONTHLY: dia do mês (1–28). WEEKLY: dia da semana (0–6, 0 = domingo). */
  dayOfRecurrence: z.number().int().min(0).max(28),
  startDate: z.coerce.date(),
  occurrences: z.number().int().min(1).max(600).nullable().optional(),
});

export type UpsertScheduledInput = z.input<typeof upsertScheduledSchema>;

/** Cria um lançamento recorrente/agendado. */
export async function createScheduledTransaction(input: UpsertScheduledInput) {
  await assertAuthorized();
  const parsed = upsertScheduledSchema.parse(input);

  if (parsed.frequency === "MONTHLY" && (parsed.dayOfRecurrence < 1 || parsed.dayOfRecurrence > 28)) {
    throw new DomainError("Para recorrência mensal, o dia deve estar entre 1 e 28.");
  }
  if (parsed.frequency === "WEEKLY" && parsed.dayOfRecurrence > 6) {
    throw new DomainError("Para recorrência semanal, o dia deve estar entre 0 (domingo) e 6 (sábado).");
  }

  const scheduled = await prisma.$transaction(async (tx) => {
    const created = await tx.scheduledTransaction.create({
      data: {
        accountId: parsed.accountId,
        categoryId: parsed.categoryId ?? null,
        amount: decimalToDb(parsed.amount.abs()),
        type: parsed.type,
        description: parsed.description,
        frequency: parsed.frequency,
        dayOfRecurrence: parsed.dayOfRecurrence,
        startDate: parsed.startDate,
        occurrences: parsed.occurrences ?? null,
      },
    });
    await recordAudit(tx, {
      action: "scheduled.create",
      entityType: "ScheduledTransaction",
      entityId: created.id,
      payload: { description: created.description, frequency: created.frequency },
    });
    return created;
  });

  revalidateDashboard();
  return scheduled;
}

/** Cancela (desativa) um agendamento — ocorrências futuras deixam de ser geradas. */
export async function deactivateScheduledTransaction(input: { id: string }) {
  await assertAuthorized();
  const { id } = z.object({ id: z.string().uuid() }).parse(input);
  await prisma.scheduledTransaction.update({ where: { id }, data: { isActive: false } });
  revalidateDashboard();
}

/** Data da próxima ocorrência de um agendamento a partir de `after`. */
function nextOccurrence(
  schedule: { frequency: "WEEKLY" | "MONTHLY"; dayOfRecurrence: number; startDate: Date },
  after: Date,
): Date | null {
  const cursor = new Date(Math.max(after.getTime(), schedule.startDate.getTime()));

  if (schedule.frequency === "MONTHLY") {
    const candidate = new Date(
      Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), schedule.dayOfRecurrence),
    );
    if (candidate > after && candidate >= schedule.startDate) return candidate;
    return new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, schedule.dayOfRecurrence));
  }

  // WEEKLY
  const candidate = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate()));
  const daysAhead = (schedule.dayOfRecurrence - candidate.getUTCDay() + 7) % 7;
  candidate.setUTCDate(candidate.getUTCDate() + daysAhead);
  if (candidate <= after || candidate < schedule.startDate) {
    candidate.setUTCDate(candidate.getUTCDate() + 7);
  }
  return candidate;
}

/**
 * Materializa as ocorrências vencidas de todos os agendamentos ativos até
 * `now`: cria as `Transaction`s reais (isPaid = true, pois a data já
 * passou) com ajuste de saldo atômico, e incrementa `generatedCount`.
 * Idempotente: o hash de reconciliação inclui o índice da ocorrência, e a
 * contagem garante que cada ocorrência seja gerada uma única vez.
 *
 * Chamada pela Netlify Scheduled Function diária (ver `netlify/functions`)
 * ou manualmente pela UI.
 */
export async function materializeScheduledTransactions(input: { now?: string } = {}) {
  await assertAuthorized();
  const now = input.now ? new Date(input.now) : new Date();

  const schedules = await prisma.scheduledTransaction.findMany({
    where: { isActive: true },
  });

  let materialized = 0;
  for (const schedule of schedules) {
    const signedAmount =
      schedule.type === "EXPENSE"
        ? toDecimal(schedule.amount.toString()).abs().negated()
        : toDecimal(schedule.amount.toString()).abs();

    const due: Date[] = [];
    let occurrenceIndex = schedule.generatedCount;
    let cursor = new Date(schedule.startDate.getTime() - 1); // começa antes do start
    while (true) {
      const next = nextOccurrence(
        {
          frequency: schedule.frequency,
          dayOfRecurrence: schedule.dayOfRecurrence,
          startDate: schedule.startDate,
        },
        cursor,
      );
      if (!next || next > now) break;
      if (schedule.occurrences !== null && occurrenceIndex >= schedule.occurrences) break;
      due.push(next);
      occurrenceIndex += 1;
      cursor = next;
    }

    if (due.length === 0) continue;

    await prisma.$transaction(async (tx) => {
      for (let i = 0; i < due.length; i += 1) {
        const index = schedule.generatedCount + i;
        await tx.transaction.create({
          data: {
            accountId: schedule.accountId,
            categoryId: schedule.categoryId,
            amount: decimalToDb(signedAmount),
            type: schedule.type,
            description: normalizeDescription(schedule.description),
            originalDescription: schedule.description,
            date: due[i],
            isPaid: true,
            isReconciled: false,
            reconciliationHash: computeReconciliationHash({
              accountId: schedule.accountId,
              date: due[i],
              amount: signedAmount,
              description: schedule.description,
              fitId: `SCHEDULED-${schedule.id}-${index}`,
            }),
          },
        });
        await tx.account.update({
          where: { id: schedule.accountId },
          data: { currentBalance: { increment: decimalToDb(signedAmount) } },
        });
      }
      await tx.scheduledTransaction.update({
        where: { id: schedule.id },
        data: {
          generatedCount: schedule.generatedCount + due.length,
          // Esgotou as ocorrências: desativa automaticamente.
          isActive:
            schedule.occurrences === null
              ? true
              : schedule.generatedCount + due.length < schedule.occurrences,
        },
      });
      await recordAudit(tx, {
        action: "scheduled.materialize",
        entityType: "ScheduledTransaction",
        entityId: schedule.id,
        payload: { generated: due.length },
      });
    });
    materialized += due.length;
  }

  if (materialized > 0) revalidateDashboard();
  return { materialized };
}
