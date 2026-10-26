import type { TransactionType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { listTransactions } from "@/lib/queries/transactions";
import { OfxDropzone } from "@/components/transactions/ofx-dropzone";
import { FilterBar } from "@/components/transactions/filter-bar";
import { TransactionsTable, type TransactionRow } from "@/components/transactions/transactions-table";
import { PaginationBar } from "@/components/pagination-bar";

const PAGE_SIZE = 20;
const VALID_TYPES: TransactionType[] = ["INCOME", "EXPENSE", "TRANSFER", "ADJUSTMENT"];
const VALID_SORT = ["date", "amount", "description"] as const;

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const sortBy = VALID_SORT.includes(params.sortBy as (typeof VALID_SORT)[number])
    ? (params.sortBy as (typeof VALID_SORT)[number])
    : "date";
  const sortDir = params.sortDir === "asc" ? "asc" : "desc";
  const type = VALID_TYPES.includes(params.type as TransactionType) ? (params.type as TransactionType) : undefined;

  const [accounts, categories, { rows, total, pageCount }] = await Promise.all([
    prisma.account.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, type: true } }),
    prisma.category.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    listTransactions({
      page,
      pageSize: PAGE_SIZE,
      accountId: params.accountId,
      categoryId: params.categoryId,
      type,
      search: params.search,
      sortBy,
      sortDir,
    }),
  ]);

  const tableRows: TransactionRow[] = rows.map((row) => ({
    id: row.id,
    date: row.date.toISOString(),
    description: row.description,
    amount: row.amount.toString(),
    type: row.type,
    isReconciled: row.isReconciled,
    installmentNumber: row.installmentNumber,
    totalInstallments: row.totalInstallments,
    account: row.account,
    category: row.category,
  }));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-on-surface">Extrato Unificado</h1>
        <p className="text-sm text-on-surface-variant">{total} transação(ões) no total.</p>
      </div>

      {/* OFX só vale para contas de movimentação — cartões têm fluxo próprio
          de faturas (o servidor também bloqueia, ver import-ofx.ts). */}
      <OfxDropzone
        accounts={accounts
          .filter((a) => a.type !== "CREDIT_CARD")
          .map((a) => ({ id: a.id, name: a.name }))}
      />
      <FilterBar accounts={accounts} categories={categories} />
      <TransactionsTable rows={tableRows} categories={categories} />
      <PaginationBar page={page} pageCount={pageCount} />
    </div>
  );
}
