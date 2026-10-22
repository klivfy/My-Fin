import type { CategoryNature } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const REVIEW_PAGE_SIZE = 50;

export interface ReviewTransaction {
  id: string;
  date: string;
  description: string;
  /** Decimal serializado (string) — nunca Number antes da apresentação. */
  amount: string;
  type: "INCOME" | "EXPENSE";
  accountName: string;
}

export interface ReviewCategory {
  id: string;
  name: string;
  type: "INCOME" | "EXPENSE";
  color: string | null;
  nature: CategoryNature | null;
}

export interface ReviewRule {
  id: string;
  pattern: string;
  categoryName: string;
}

export interface ReviewData {
  pendingCount: number;
  pending: ReviewTransaction[];
  categories: ReviewCategory[];
  rules: ReviewRule[];
  aiEnabled: boolean;
}

/** Dados da tela "Revisar": fila sem categoria, categorias e regras. */
export async function getReviewData(): Promise<ReviewData> {
  const where = { categoryId: null, type: { in: ["INCOME", "EXPENSE"] as Array<"INCOME" | "EXPENSE"> } };

  const [pendingCount, pending, categories, rules] = await Promise.all([
    prisma.transaction.count({ where }),
    prisma.transaction.findMany({
      where,
      orderBy: [{ date: "desc" }, { id: "asc" }],
      take: REVIEW_PAGE_SIZE,
      select: {
        id: true,
        date: true,
        description: true,
        amount: true,
        type: true,
        account: { select: { name: true } },
      },
    }),
    prisma.category.findMany({
      orderBy: [{ type: "asc" }, { name: "asc" }],
      select: { id: true, name: true, type: true, color: true, nature: true },
    }),
    prisma.categorizationRule.findMany({
      orderBy: { pattern: "asc" },
      select: { id: true, pattern: true, category: { select: { name: true } } },
    }),
  ]);

  return {
    pendingCount,
    pending: pending.map((t) => ({
      id: t.id,
      date: t.date.toISOString(),
      description: t.description,
      amount: t.amount.toString(),
      type: t.type as "INCOME" | "EXPENSE",
      accountName: t.account.name,
    })),
    categories,
    rules: rules.map((r) => ({ id: r.id, pattern: r.pattern, categoryName: r.category.name })),
    aiEnabled: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
  };
}
