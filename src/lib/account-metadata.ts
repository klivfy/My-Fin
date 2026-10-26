import { z } from "zod";
import { DEFAULT_CLOSING_DAY, DEFAULT_DUE_DAY } from "./constants";

/**
 * Schema do `Account.metadata` (Json livre no banco): valida na borda o que
 * antes era lido com cast às cegas. Campos ausentes caem nos defaults.
 */
export const accountMetadataSchema = z.object({
  creditLimit: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, "creditLimit inválido")
    .optional(),
  /** Dia de fechamento da fatura (1–28). Default: 25. */
  closingDay: z.number().int().min(1).max(28).optional(),
  /** Dia de vencimento da fatura (1–28). Default: 5. */
  dueDay: z.number().int().min(1).max(28).optional(),
});

export type AccountMetadata = z.infer<typeof accountMetadataSchema>;

/** Parse tolerante: metadata inválido/ausente degrada para objeto vazio. */
export function parseAccountMetadata(raw: unknown): AccountMetadata {
  if (!raw || typeof raw !== "object") return {};
  const parsed = accountMetadataSchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
}

export interface InvoiceCycle {
  closingDay: number;
  dueDay: number;
}

/** Ciclo de fatura efetivo de uma conta (metadata > defaults do produto). */
export function invoiceCycleOf(metadata: AccountMetadata): InvoiceCycle {
  return {
    closingDay: metadata.closingDay ?? DEFAULT_CLOSING_DAY,
    dueDay: metadata.dueDay ?? DEFAULT_DUE_DAY,
  };
}
