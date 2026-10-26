"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown, Landmark, Trash2, Check, Tag } from "lucide-react";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Money } from "@/components/money";
import { formatDateShort } from "@/lib/format";
import {
  deleteTransactions,
  setTransactionsCategory,
  setTransactionsReconciled,
} from "@/actions/transactions";
import { EditTransactionDialog } from "./edit-transaction-dialog";
import { cn } from "@/lib/utils";

export interface TransactionRow {
  id: string;
  date: string;
  description: string;
  amount: string;
  type: "INCOME" | "EXPENSE" | "TRANSFER" | "ADJUSTMENT";
  isReconciled: boolean;
  installmentNumber: number | null;
  totalInstallments: number | null;
  account: { id: string; name: string };
  category: { id: string; name: string; color: string | null } | null;
}

interface CategoryOption {
  id: string;
  name: string;
}

const SORT_COLUMNS = [
  { key: "date", label: "Data" },
  { key: "description", label: "Descrição" },
] as const;

export function TransactionsTable({
  rows,
  categories,
}: {
  rows: TransactionRow[];
  categories: CategoryOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const sortBy = searchParams.get("sortBy") ?? "date";
  const sortDir = searchParams.get("sortDir") ?? "desc";

  function toggleSort(column: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (sortBy === column) {
      params.set("sortDir", sortDir === "asc" ? "desc" : "asc");
    } else {
      params.set("sortBy", column);
      params.set("sortDir", "desc");
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  function renderSortButton(column: string, label: string, className?: string) {
    return (
      <button
        onClick={() => toggleSort(column)}
        className={cn(
          "flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-on-surface-variant hover:text-on-surface",
          className,
        )}
      >
        {label}
        {sortBy === column ? (
          sortDir === "asc" ? (
            <ArrowUp className="size-3" />
          ) : (
            <ArrowDown className="size-3" />
          )
        ) : (
          <ArrowUpDown className="size-3 opacity-40" />
        )}
      </button>
    );
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))));
  }

  function applyCategory(ids: string[], categoryId: string | null) {
    startTransition(async () => {
      try {
        await setTransactionsCategory({ ids, categoryId });
        toast.success("Categoria atualizada.");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Erro ao categorizar.");
      }
    });
  }

  function reconcileSelected() {
    const ids = Array.from(selected);
    startTransition(async () => {
      try {
        await setTransactionsReconciled({ ids, isReconciled: true });
        toast.success(`${ids.length} transação(ões) conciliada(s).`);
        setSelected(new Set());
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Erro ao conciliar.");
      }
    });
  }

  function deleteSelected() {
    const ids = Array.from(selected);
    if (!confirm(`Excluir ${ids.length} transação(ões)? Esta ação não pode ser desfeita.`)) return;
    startTransition(async () => {
      try {
        await deleteTransactions({ ids });
        toast.success(`${ids.length} transação(ões) excluída(s).`);
        setSelected(new Set());
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Erro ao excluir.");
      }
    });
  }

  return (
    <div className="relative">
      <div className="overflow-x-auto rounded-xl border border-outline-variant">
        <Table>
          <TableHeader>
            <TableRow className="bg-surface-container-low hover:bg-surface-container-low">
              <TableHead className="w-10">
                <Checkbox
                  checked={rows.length > 0 && selected.size === rows.length}
                  onCheckedChange={toggleAll}
                  aria-label="Selecionar todas"
                />
              </TableHead>
              <TableHead className="w-10" />
              {SORT_COLUMNS.map((col) => (
                <TableHead key={col.key}>{renderSortButton(col.key, col.label)}</TableHead>
              ))}
              <TableHead>Conta</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">{renderSortButton("amount", "Valor", "ml-auto")}</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-10 text-center text-sm text-on-surface-variant">
                  Nenhuma transação encontrada para os filtros atuais.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id} data-state={selected.has(row.id) ? "selected" : undefined}>
                  <TableCell>
                    <Checkbox checked={selected.has(row.id)} onCheckedChange={() => toggleRow(row.id)} />
                  </TableCell>
                  <TableCell>
                    <Avatar className="size-7">
                      <AvatarFallback className="text-[10px]">
                        <Landmark className="size-3.5" />
                      </AvatarFallback>
                    </Avatar>
                  </TableCell>
                  <TableCell className="tabular-nums whitespace-nowrap text-sm">
                    {formatDateShort(row.date)}
                  </TableCell>
                  <TableCell className="max-w-56 truncate text-sm">
                    {row.description}
                    {row.installmentNumber && row.totalInstallments && (
                      <span className="ml-1.5 text-xs text-on-surface-variant">
                        ({row.installmentNumber}/{row.totalInstallments})
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-on-surface-variant">{row.account.name}</TableCell>
                  <TableCell>
                    <Popover>
                      <PopoverTrigger
                        render={
                          <button className="inline-flex items-center gap-1 rounded-full border border-outline-variant px-2 py-0.5 text-xs hover:bg-surface-container-high">
                            <span
                              className="size-1.5 rounded-full"
                              style={{ backgroundColor: row.category?.color ?? "var(--color-outline)" }}
                            />
                            {row.category?.name ?? "Sem categoria"}
                          </button>
                        }
                      />
                      <PopoverContent className="w-48 p-1">
                        <button
                          onClick={() => applyCategory([row.id], null)}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
                        >
                          <Tag className="size-3" /> Sem categoria
                        </button>
                        {categories.map((category) => (
                          <button
                            key={category.id}
                            onClick={() => applyCategory([row.id], category.id)}
                            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
                          >
                            {category.name}
                          </button>
                        ))}
                      </PopoverContent>
                    </Popover>
                  </TableCell>
                  <TableCell>
                    <Badge variant={row.isReconciled ? "default" : "outline"} className="text-[10px]">
                      {row.isReconciled ? "Conciliado" : "Pendente"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={row.amount} tone={row.type === "TRANSFER" ? "transfer" : "auto"} />
                  </TableCell>
                  <TableCell>
                    <EditTransactionDialog row={row} categories={categories} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {selected.size > 0 && (
        <div
          className={cn(
            "fixed inset-x-0 bottom-20 z-40 mx-auto flex w-fit items-center gap-2 rounded-full border border-outline-variant bg-surface-container-highest px-4 py-2 shadow-lg md:bottom-6",
          )}
        >
          <span className="text-sm font-medium text-on-surface">{selected.size} selecionada(s)</span>
          <Popover>
            <PopoverTrigger
              render={
                <Button variant="ghost" size="sm" className="gap-1" disabled={pending}>
                  <Tag className="size-3.5" /> Recategorizar
                </Button>
              }
            />
            <PopoverContent className="w-48 p-1">
              {categories.map((category) => (
                <button
                  key={category.id}
                  onClick={() => applyCategory(Array.from(selected), category.id)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
                >
                  {category.name}
                </button>
              ))}
            </PopoverContent>
          </Popover>
          <Button variant="ghost" size="sm" className="gap-1" onClick={reconcileSelected} disabled={pending}>
            <Check className="size-3.5" /> Conciliar
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1 text-expense hover:text-expense"
            onClick={deleteSelected}
            disabled={pending}
          >
            <Trash2 className="size-3.5" /> Excluir
          </Button>
        </div>
      )}
    </div>
  );
}
