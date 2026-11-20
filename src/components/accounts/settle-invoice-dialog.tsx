"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Money } from "@/components/money";
import { settleInvoice } from "@/actions/credit-cards";

interface AccountOption {
  id: string;
  name: string;
}

export function SettleInvoiceDialog({
  invoiceId,
  totalAmount,
  payerAccounts,
  trigger,
}: {
  invoiceId: string;
  totalAmount: string;
  payerAccounts: AccountOption[];
  trigger: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [payingAccountId, setPayingAccountId] = useState(payerAccounts[0]?.id ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit() {
    setError(null);
    if (!payingAccountId) {
      setError("Selecione a conta pagadora.");
      return;
    }
    startTransition(async () => {
      try {
        await settleInvoice({ invoiceId, payingAccountId, paymentDate: new Date().toISOString() });
        toast.success("Fatura liquidada.");
        setOpen(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao liquidar fatura.");
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setError(null);
      }}
    >
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>Pagar fatura</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-lg bg-surface-container-high px-3 py-2">
            <span className="text-sm text-on-surface-variant">Total da fatura</span>
            <Money value={-Number(totalAmount)} tone="expense" showSign={false} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-on-surface-variant">Pagar com</label>
            <Select value={payingAccountId} onValueChange={(value) => setPayingAccountId(value as string)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Selecione a conta" />
              </SelectTrigger>
              <SelectContent>
                {payerAccounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <FormError message={error} />
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={pending}>
            {pending ? "Processando…" : "Confirmar pagamento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
