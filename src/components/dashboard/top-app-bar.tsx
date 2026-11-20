"use client";

import { usePathname } from "next/navigation";
import { PeriodSegmentedControl } from "@/components/period-segmented-control";
import { PrivacyToggle } from "@/components/dashboard/privacy-toggle";
import { SyncIndicator, type SyncIndicatorData } from "@/components/dashboard/sync-indicator";
import {
  NewTransactionDialog,
  type AccountOption,
  type CategoryOption,
} from "@/components/dashboard/new-transaction-dialog";

/**
 * Barra superior única para as duas seções. Só mostra o que age sobre a tela
 * atual: o período filtra finanças e o diário; o painel de risco é sempre de
 * hoje e do mês corrente; "Nova transação" e a sincronização são de finanças.
 */
export function TopAppBar({
  lastSync,
  accounts,
  categories,
}: {
  lastSync: SyncIndicatorData | null;
  accounts: AccountOption[];
  categories: CategoryOption[];
}) {
  const pathname = usePathname();
  const trading = ["/trading", "/investimentos"].some((p) => pathname === p || pathname.startsWith(`${p}/`));
  // Telas que não dependem de período (risco do dia, carteira acumulada, plano de dívidas).
  const showPeriod = !["/trading/risco", "/investimentos", "/dividas"].includes(pathname);

  return (
    <header className="sticky top-0 z-30 flex min-h-14 items-center gap-3 border-b border-outline-variant bg-surface px-4 py-2.5 sm:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {showPeriod && <PeriodSegmentedControl />}
        {!trading && <SyncIndicator lastSync={lastSync} />}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <PrivacyToggle />
        {!trading && <NewTransactionDialog accounts={accounts} categories={categories} />}
      </div>
    </header>
  );
}
