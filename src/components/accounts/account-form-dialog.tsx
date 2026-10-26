"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus, Power } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createAccount, deactivateAccount, updateAccount } from "@/actions/accounts";

const ACCOUNT_TYPES = [
  { value: "CHECKING", label: "Conta corrente" },
  { value: "SAVINGS", label: "Poupança" },
  { value: "CREDIT_CARD", label: "Cartão de crédito" },
  { value: "INVESTMENT", label: "Investimento" },
  { value: "CASH", label: "Dinheiro" },
] as const;

type AccountType = (typeof ACCOUNT_TYPES)[number]["value"];

/** Dialog de criação de conta (FAB na tela Contas). */
export function AccountFormDialog({
  mode,
  account,
  trigger,
}: {
  mode: "create" | "edit";
  account?: {
    id: string;
    name: string;
    type: AccountType;
    creditLimit: string | null;
    closingDay?: number | null;
    dueDay?: number | null;
  };
  trigger: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const [name, setName] = useState(account?.name ?? "");
  const [type, setType] = useState<AccountType>(account?.type ?? "CHECKING");
  const [initialBalance, setInitialBalance] = useState("0,00");
  const [creditLimit, setCreditLimit] = useState(account?.creditLimit ?? "");
  const [closingDay, setClosingDay] = useState(account?.closingDay?.toString() ?? "");
  const [dueDay, setDueDay] = useState(account?.dueDay?.toString() ?? "");

  // Re-inicializa o formulário quando o dialog abre (sem useEffect: o estado
  // é derivado da abertura + props atuais).
  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next && account) {
      setName(account.name);
      setType(account.type);
      setCreditLimit(account.creditLimit ?? "");
      setClosingDay(account.closingDay?.toString() ?? "");
      setDueDay(account.dueDay?.toString() ?? "");
    }
  }

  const isCreditCard = type === "CREDIT_CARD";

  function handleSubmit() {
    if (!name.trim()) {
      toast.error("Informe o nome da conta.");
      return;
    }
    startTransition(async () => {
      try {
        const cycle = {
          closingDay: closingDay ? Number(closingDay) : undefined,
          dueDay: dueDay ? Number(dueDay) : undefined,
        };
        if (mode === "create") {
          await createAccount({
            name: name.trim(),
            type,
            initialBalance,
            creditLimit: isCreditCard && creditLimit ? creditLimit : undefined,
            ...(isCreditCard ? cycle : {}),
          });
          toast.success("Conta criada.");
        } else if (account) {
          await updateAccount({
            id: account.id,
            name: name.trim(),
            creditLimit: isCreditCard ? creditLimit || null : null,
            closingDay: isCreditCard ? (cycle.closingDay ?? null) : null,
            dueDay: isCreditCard ? (cycle.dueDay ?? null) : null,
          });
          toast.success("Conta atualizada.");
        }
        setOpen(false);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Erro ao salvar conta.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Nova conta" : "Editar conta"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="acc-name">Nome</Label>
            <Input id="acc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Nubank" />
          </div>

          {mode === "create" && (
            <>
              <div className="space-y-1.5">
                <Label>Tipo</Label>
                <Select value={type} onValueChange={(v) => setType(v as AccountType)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ACCOUNT_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="acc-initial">Saldo inicial (R$)</Label>
                <Input
                  id="acc-initial"
                  inputMode="decimal"
                  value={initialBalance}
                  onChange={(e) => setInitialBalance(e.target.value)}
                />
              </div>
            </>
          )}

          {isCreditCard && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="acc-limit">Limite do cartão (R$, opcional)</Label>
                <Input
                  id="acc-limit"
                  inputMode="decimal"
                  value={creditLimit}
                  onChange={(e) => setCreditLimit(e.target.value)}
                  placeholder="0,00"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="acc-closing">Dia de fechamento</Label>
                  <Input
                    id="acc-closing"
                    inputMode="numeric"
                    value={closingDay}
                    onChange={(e) => setClosingDay(e.target.value)}
                    placeholder="25"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="acc-due">Dia de vencimento</Label>
                  <Input
                    id="acc-due"
                    inputMode="numeric"
                    value={dueDay}
                    onChange={(e) => setDueDay(e.target.value)}
                    placeholder="5"
                  />
                </div>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={pending}>
            {pending ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Botões de ação do cartão de conta: editar e desativar. */
export function AccountActions({
  account,
}: {
  account: {
    id: string;
    name: string;
    type: AccountType;
    creditLimit: string | null;
    closingDay?: number | null;
    dueDay?: number | null;
  };
}) {
  const [pending, startTransition] = useTransition();

  function handleDeactivate() {
    if (!confirm("Desativar esta conta? Ela sumirá da UI (o histórico é preservado).")) return;
    startTransition(async () => {
      try {
        await deactivateAccount({ id: account.id });
        toast.success("Conta desativada.");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Erro ao desativar conta.");
      }
    });
  }

  return (
    <div className="flex items-center gap-1">
      <AccountFormDialog
        mode="edit"
        account={account}
        trigger={
          <Button variant="ghost" size="icon" title="Editar conta">
            <Pencil className="size-4" />
          </Button>
        }
      />
      <Button variant="ghost" size="icon" title="Desativar conta" onClick={handleDeactivate} disabled={pending}>
        <Power className="size-4" />
      </Button>
    </div>
  );
}

/** Botão "+ Nova conta" do cabeçalho da tela Contas. */
export function NewAccountButton() {
  return (
    <AccountFormDialog
      mode="create"
      trigger={
        <Button size="sm" className="gap-1.5">
          <Plus className="size-4" /> Nova conta
        </Button>
      }
    />
  );
}
