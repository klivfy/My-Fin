"use client";

import { useState, useTransition } from "react";
import { CalendarClock, Plus, Trash2 } from "lucide-react";
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
import {
  createScheduledTransaction,
  deactivateScheduledTransaction,
  materializeScheduledTransactions,
} from "@/actions/scheduled";

interface AccountOption {
  id: string;
  name: string;
}

export interface ScheduledView {
  id: string;
  description: string;
  amount: string;
  type: "INCOME" | "EXPENSE";
  frequency: "WEEKLY" | "MONTHLY";
  dayOfRecurrence: number;
  accountName: string;
}

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/** Painel de lançamentos recorrentes/agendados na tela Contas. */
export function ScheduledPanel({
  scheduled,
  accounts,
}: {
  scheduled: ScheduledView[];
  accounts: AccountOption[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [type, setType] = useState<"INCOME" | "EXPENSE">("EXPENSE");
  const [frequency, setFrequency] = useState<"WEEKLY" | "MONTHLY">("MONTHLY");
  const [dayOfRecurrence, setDayOfRecurrence] = useState("5");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [occurrences, setOccurrences] = useState("");

  function handleSubmit() {
    if (!description.trim() || !amount || !accountId) {
      toast.error("Preencha descrição, valor e conta.");
      return;
    }
    startTransition(async () => {
      try {
        await createScheduledTransaction({
          accountId,
          amount,
          type,
          description: description.trim(),
          frequency,
          dayOfRecurrence: Number(dayOfRecurrence),
          startDate: new Date().toISOString(),
          occurrences: occurrences ? Number(occurrences) : null,
        });
        toast.success("Agendamento criado.");
        setOpen(false);
        setDescription("");
        setAmount("");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Erro ao criar agendamento.");
      }
    });
  }

  function handleDeactivate(id: string) {
    startTransition(async () => {
      try {
        await deactivateScheduledTransaction({ id });
        toast.success("Agendamento cancelado.");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Erro ao cancelar.");
      }
    });
  }

  function handleMaterialize() {
    startTransition(async () => {
      try {
        const result = await materializeScheduledTransactions({});
        toast.success(
          result.materialized > 0
            ? `${result.materialized} lançamento(s) materializado(s).`
            : "Nenhuma ocorrência vencida no momento.",
        );
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Erro ao materializar.");
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold text-on-surface">
          <CalendarClock className="size-4" /> Lançamentos recorrentes
        </h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleMaterialize} disabled={pending}>
            Processar vencidos
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger
              render={
                <Button size="sm" className="gap-1.5">
                  <Plus className="size-4" /> Agendar
                </Button>
              }
            />
            <DialogContent className="sm:max-w-sm">
              <DialogHeader>
                <DialogTitle>Novo lançamento recorrente</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="sch-desc">Descrição</Label>
                  <Input id="sch-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex.: Aluguel" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="sch-amount">Valor (R$)</Label>
                    <Input id="sch-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Tipo</Label>
                    <Select value={type} onValueChange={(v) => setType(v as "INCOME" | "EXPENSE")}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="EXPENSE">Despesa</SelectItem>
                        <SelectItem value="INCOME">Receita</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Frequência</Label>
                    <Select value={frequency} onValueChange={(v) => setFrequency(v as "WEEKLY" | "MONTHLY")}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MONTHLY">Mensal</SelectItem>
                        <SelectItem value="WEEKLY">Semanal</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="sch-day">{frequency === "MONTHLY" ? "Dia do mês (1–28)" : "Dia da semana (0–6)"}</Label>
                    <Input id="sch-day" inputMode="numeric" value={dayOfRecurrence} onChange={(e) => setDayOfRecurrence(e.target.value)} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Conta</Label>
                    <Select value={accountId} onValueChange={(v) => setAccountId(v as string)}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {accounts.map((account) => (
                          <SelectItem key={account.id} value={account.id}>
                            {account.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="sch-occ">Ocorrências (vazio = sem fim)</Label>
                    <Input id="sch-occ" inputMode="numeric" value={occurrences} onChange={(e) => setOccurrences(e.target.value)} placeholder="∞" />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={handleSubmit} disabled={pending}>
                  {pending ? "Salvando…" : "Criar agendamento"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {scheduled.length === 0 ? (
        <p className="text-sm text-on-surface-variant">
          Nenhum lançamento recorrente. Agende salário, aluguel ou assinaturas para materialização automática diária.
        </p>
      ) : (
        <ul className="divide-y divide-outline-variant rounded-xl border border-outline-variant">
          {scheduled.map((item) => (
            <li key={item.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span className="min-w-0 truncate text-on-surface">
                {item.description}
                <span className="ml-2 text-xs text-on-surface-variant">
                  {item.frequency === "MONTHLY"
                    ? `todo dia ${item.dayOfRecurrence}`
                    : `toda ${WEEKDAYS[item.dayOfRecurrence]}`}{" "}
                  · {item.accountName}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className={item.type === "EXPENSE" ? "text-expense" : "text-income"}>
                  {item.type === "EXPENSE" ? "−" : "+"} R$ {item.amount}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  title="Cancelar agendamento"
                  disabled={pending}
                  onClick={() => handleDeactivate(item.id)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
