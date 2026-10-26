"use client";

import { useState } from "react";
import { ChevronDown, CreditCard } from "lucide-react";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { formatDateShort, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SettleInvoiceDialog } from "@/components/accounts/settle-invoice-dialog";
import { ReverseSettlementButton } from "@/components/accounts/reverse-settlement-button";
import { Button } from "@/components/ui/button";
import type { CreditCardView } from "@/lib/queries/accounts";

interface AccountOption {
  id: string;
  name: string;
}

export function CreditCardModule({
  creditCard,
  currentBalance,
  creditLimit,
  payerAccounts,
}: {
  creditCard: CreditCardView;
  currentBalance: string;
  creditLimit: string | null;
  payerAccounts: AccountOption[];
}) {
  const [expanded, setExpanded] = useState(false);
  const today = new Date();

  const sortedInvoices = [...creditCard.invoices].sort(
    (a, b) => new Date(a.closingDate).getTime() - new Date(b.closingDate).getTime(),
  );
  const currentInvoice =
    sortedInvoices.find((inv) => inv.status !== "PAID" && new Date(inv.closingDate) >= today) ??
    sortedInvoices.find((inv) => inv.status !== "PAID");
  const overdueInvoices = sortedInvoices.filter(
    (inv) => inv.status !== "PAID" && inv.id !== currentInvoice?.id,
  );
  const paidInvoices = sortedInvoices.filter((inv) => inv.status === "PAID");

  const limit = creditLimit ? Number(creditLimit) : null;
  const totalDebt = Math.abs(Number(currentBalance));
  const currentInvoiceTotal = currentInvoice ? Number(currentInvoice.totalAmount) : 0;
  const futureCommitted = Math.max(0, totalDebt - currentInvoiceTotal);
  const available = limit !== null ? Math.max(0, limit - totalDebt) : null;

  // Régua temporal: posição de "hoje" entre o fechamento anterior e o atual.
  let cycleProgressPct = 0;
  if (currentInvoice) {
    const closing = new Date(currentInvoice.closingDate).getTime();
    const previousClosing = closing - 30 * 86_400_000;
    cycleProgressPct = Math.min(
      1,
      Math.max(0, (today.getTime() - previousClosing) / (closing - previousClosing)),
    );
  }

  return (
    <div className="space-y-4 rounded-2xl border border-outline-variant bg-surface-container-low p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-on-surface">
          <CreditCard className="size-4" />
          Fatura atual
        </div>
        {currentInvoice && (
          <Badge variant={currentInvoice.status === "CLOSED" ? "secondary" : "outline"}>
            {currentInvoice.status === "OPEN" ? "Aberta" : "Fechada"}
          </Badge>
        )}
      </div>

      {currentInvoice ? (
        <>
          <div className="flex items-baseline justify-between">
            <Money value={-currentInvoiceTotal} tone="expense" showSign={false} className="text-xl" />
            {payerAccounts.length > 0 && (
              <SettleInvoiceDialog
                invoiceId={currentInvoice.id}
                totalAmount={currentInvoice.totalAmount}
                payerAccounts={payerAccounts}
                trigger={<Button size="sm">Pagar fatura</Button>}
              />
            )}
          </div>

          <div className="space-y-1.5">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-container-highest">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${cycleProgressPct * 100}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-on-surface-variant">
              <span>Fecha {formatDateShort(currentInvoice.closingDate)}</span>
              <span>Vence {formatDateShort(currentInvoice.dueDate)}</span>
            </div>
          </div>
        </>
      ) : (
        <p className="text-sm text-on-surface-variant">Nenhuma fatura em aberto.</p>
      )}

      {overdueInvoices.length > 0 && (
        <div className="space-y-2 border-t border-outline-variant pt-3">
          <p className="text-xs font-medium text-on-surface-variant">Faturas anteriores em aberto</p>
          {overdueInvoices.map((invoice) => (
            <div key={invoice.id} className="flex items-center justify-between text-sm">
              <span className="text-on-surface-variant">Venceu {formatDateShort(invoice.dueDate)}</span>
              <div className="flex items-center gap-2">
                <Money value={-Number(invoice.totalAmount)} tone="expense" showSign={false} />
                {payerAccounts.length > 0 && (
                  <SettleInvoiceDialog
                    invoiceId={invoice.id}
                    totalAmount={invoice.totalAmount}
                    payerAccounts={payerAccounts}
                    trigger={
                      <Button size="sm" variant="outline">
                        Pagar
                      </Button>
                    }
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {paidInvoices.length > 0 && (
        <div className="space-y-2 border-t border-outline-variant pt-3">
          <p className="text-xs font-medium text-on-surface-variant">Faturas pagas recentemente</p>
          {paidInvoices.map((invoice) => (
            <div key={invoice.id} className="flex items-center justify-between text-sm">
              <span className="text-on-surface-variant">Fechou {formatDateShort(invoice.closingDate)}</span>
              <div className="flex items-center gap-2">
                <Money value={-Number(invoice.totalAmount)} tone="expense" showSign={false} />
                <ReverseSettlementButton invoiceId={invoice.id} />
              </div>
            </div>
          ))}
        </div>
      )}

      {limit !== null && (
        <div className="space-y-1.5 border-t border-outline-variant pt-3">
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-surface-container-highest">
            <div className="h-full bg-expense" style={{ width: `${(currentInvoiceTotal / limit) * 100}%` }} />
            <div className="h-full bg-transfer" style={{ width: `${(futureCommitted / limit) * 100}%` }} />
            <div className="h-full bg-income/40" style={{ width: `${((available ?? 0) / limit) * 100}%` }} />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-on-surface-variant">
            <span>Fatura atual: {formatPercent(currentInvoiceTotal / limit, 0)}</span>
            <span>Parcelado: {formatPercent(futureCommitted / limit, 0)}</span>
            <span>Disponível: {formatPercent((available ?? 0) / limit, 0)}</span>
          </div>
        </div>
      )}

      {creditCard.installmentGroups.length > 0 && (
        <div className="border-t border-outline-variant pt-3">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex w-full items-center justify-between text-xs font-medium text-on-surface-variant"
          >
            Parcelamentos ativos ({creditCard.installmentGroups.length})
            <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
          </button>
          {expanded && (
            <ul className="mt-2 space-y-2">
              {creditCard.installmentGroups.map((group) => (
                <li key={group.rootId} className="flex items-center justify-between text-sm">
                  <span className="truncate pr-2 text-on-surface">{group.description}</span>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">
                      Parcela {group.paidCount} de {group.totalInstallments}
                    </Badge>
                    <Money value={-Number(group.installmentAmount)} tone="expense" showSign={false} className="text-xs" />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
