"use server";

import Decimal from "decimal.js";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { runAction, UserFacingError, type ActionResult } from "@/lib/action-result";
import { B3ImportError, parseB3Negociacao } from "@/lib/investments/b3-negociacao";
import { pairAcrossSources, withMatchKeys } from "@/lib/investments/common";
import { asDate, storedTrades, tradeData, withSyncLog, type ImportResult } from "@/lib/investments/persist";
import { allocateFees, NotaError, parseNotaSinacor } from "@/lib/investments/nota-sinacor";
import { extractPdfPages, PdfError } from "@/lib/investments/pdf-text";
import { readFirstSheet, XlsxError } from "@/lib/investments/xlsx";

export type { ImportResult };

/** A Vercel corta corpo acima de 4,5 MB; o next.config sobe o limite das Server Actions para 4 MB. */
const MAX_BYTES = 4 * 1024 * 1024;
const TOLERANCE = new Decimal("0.01");
/** Uma planilha de anos de negócios pode passar do limite padrão de 5 s. */
const TX_OPTIONS = { timeout: 30_000, maxWait: 10_000 };

function revalidateInvestments() {
  try {
    revalidatePath("/investimentos");
  } catch {
    // fora de uma requisição Next (ver lib/revalidate.ts)
  }
}

function requireFile(formData: FormData, ext: string, label: string): File {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new UserFacingError(`Escolha ${label}.`);
  if (file.size > MAX_BYTES) throw new UserFacingError("Arquivo maior que 4 MB.");
  if (!file.name.toLowerCase().endsWith(ext)) throw new UserFacingError(`O arquivo precisa ser ${ext}.`);
  return file;
}

/**
 * Planilha de negociação da Área do Investidor da B3. A B3 é a fonte
 * canônica do código de negociação: um negócio que já veio de uma nota
 * ganha o código e a chave da B3, sem duplicar.
 */
export async function importB3Negociacao(formData: FormData): Promise<ActionResult<ImportResult>> {
  return runAction(async () => {
    const file = requireFile(formData, ".xlsx", "a planilha .xlsx exportada da B3");
    let trades;
    try {
      trades = withMatchKeys(parseB3Negociacao(readFirstSheet(Buffer.from(await file.arrayBuffer()))));
    } catch (error) {
      if (error instanceof B3ImportError || error instanceof XlsxError) throw new UserFacingError(error.message);
      throw error;
    }

    const result = await withSyncLog("B3_XLSX", (syncLogId) =>
      prisma.$transaction(async (tx) => {
        const known = await tx.investmentTrade.findMany({
          where: { matchKey: { in: trades.map((t) => t.matchKey) } },
          select: { matchKey: true },
        });
        const knownKeys = new Set(known.map((k) => k.matchKey));
        const fresh = trades.filter((t) => !knownKeys.has(t.matchKey));

        const fromOtherSources = await storedTrades(
          tx,
          fresh.map((t) => t.tradeDate),
          // Negócios que vieram antes pela nota ou pelo Pluggy ganham o código da B3, sem duplicar.
          { source: { in: ["BROKERAGE_NOTE_PDF", "PLUGGY"] } },
        );
        const { pairs, unmatched } = pairAcrossSources(fresh, fromOtherSources);
        for (const { incoming, existing } of pairs) {
          await tx.investmentTrade.update({
            where: { id: existing.id },
            data: { ticker: incoming.ticker, market: incoming.market, matchKey: incoming.matchKey },
          });
        }
        const { count } = await tx.investmentTrade.createMany({
          data: unmatched.map((t) => tradeData(t, "B3_XLSX", syncLogId)),
          skipDuplicates: true,
        });
        return { read: trades.length, inserted: count, matched: pairs.length, skipped: trades.length - count - pairs.length };
      }, TX_OPTIONS),
    );
    revalidateInvestments();
    return result;
  });
}

/**
 * Nota de corretagem em PDF (SINACOR). Grava a nota, rateia os custos entre
 * os negócios e liga cada negócio ao que já veio da B3. O PDF não é salvo.
 */
export async function importBrokerageNote(formData: FormData): Promise<ActionResult<ImportResult>> {
  return runAction(async () => {
    const file = requireFile(formData, ".pdf", "a nota de corretagem em PDF");
    const password = String(formData.get("password") ?? "").trim() || undefined;

    let notes;
    try {
      notes = parseNotaSinacor(await extractPdfPages(new Uint8Array(await file.arrayBuffer()), password));
    } catch (error) {
      if (error instanceof NotaError || error instanceof PdfError) throw new UserFacingError(error.message);
      throw error;
    }
    const broken = notes.find((n) => n.difference.abs().gt(TOLERANCE));
    if (broken) {
      throw new UserFacingError(
        `Nota ${broken.noteNumber}: a soma dos negócios e custos não bate com o líquido (diferença de R$ ${broken.difference.toFixed(2)}). Nada foi gravado.`,
      );
    }

    const result = await withSyncLog("BROKERAGE_NOTE_PDF", (syncLogId) =>
      prisma.$transaction(async (tx) => {
        const totals: ImportResult = { read: 0, inserted: 0, matched: 0, skipped: 0 };
        for (const note of notes) {
          totals.read += note.trades.length;
          const exists = await tx.brokerageNote.findUnique({
            where: { broker_noteNumber: { broker: note.broker, noteNumber: note.noteNumber } },
            select: { id: true },
          });
          if (exists) {
            totals.skipped += note.trades.length;
            continue;
          }

          const saved = await tx.brokerageNote.create({
            data: {
              broker: note.broker,
              noteNumber: note.noteNumber,
              tradeDate: asDate(note.tradeDate),
              settlementFee: note.fees.settlementFee.toFixed(2),
              registrationFee: note.fees.registrationFee.toFixed(2),
              emoluments: note.fees.emoluments.toFixed(2),
              brokerage: note.fees.brokerage.toFixed(2),
              taxes: note.fees.taxes.toFixed(2),
              otherFees: note.fees.otherFees.toFixed(2),
              totalFees: note.totalFees.toFixed(2),
              irrf: note.irrf.toFixed(2),
              netAmount: note.netAmount.toFixed(2),
              settlementDate: note.settlementDate ? asDate(note.settlementDate) : null,
              syncLogId,
            },
          });

          const fees = allocateFees(
            note.trades.map((t) => t.grossAmount),
            note.totalFees,
          );
          const keyed = withMatchKeys(note.trades).map((t, i) => ({ ...t, fee: fees[i] }));
          const candidates = await storedTrades(tx, [note.tradeDate], { brokerageNoteId: null });
          const { pairs, unmatched } = pairAcrossSources(keyed, candidates);

          for (const { incoming, existing } of pairs) {
            await tx.investmentTrade.update({
              where: { id: existing.id },
              data: { fees: incoming.fee.toFixed(2), brokerageNoteId: saved.id, broker: note.broker },
            });
          }
          const { count } = await tx.investmentTrade.createMany({
            data: unmatched.map((t) => ({
              ...tradeData(t, "BROKERAGE_NOTE_PDF", syncLogId),
              fees: t.fee.toFixed(2),
              brokerageNoteId: saved.id,
            })),
            skipDuplicates: true,
          });
          totals.inserted += count;
          totals.matched += pairs.length;
          totals.skipped += unmatched.length - count;
        }
        return totals;
      }, TX_OPTIONS),
    );
    revalidateInvestments();
    return result;
  });
}
