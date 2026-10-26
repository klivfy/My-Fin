import { Landmark } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { listAccountViews } from "@/lib/queries/accounts";
import { AccountCard } from "@/components/accounts/account-card";
import { AuditBalancesButton } from "@/components/accounts/audit-balances-button";
import { NewAccountButton } from "@/components/accounts/account-form-dialog";
import { ScheduledPanel, type ScheduledView } from "@/components/accounts/scheduled-panel";
import { EmptyState } from "@/components/dashboard/empty-state";

export default async function AccountsPage() {
  const [accounts, scheduledRows] = await Promise.all([
    listAccountViews(),
    prisma.scheduledTransaction.findMany({
      where: { isActive: true },
      include: { account: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const payerAccounts = accounts
    .filter((a) => a.type !== "CREDIT_CARD")
    .map((a) => ({ id: a.id, name: a.name }));

  const scheduled: ScheduledView[] = scheduledRows.map((row) => ({
    id: row.id,
    description: row.description,
    amount: row.amount.toString(),
    type: row.type as "INCOME" | "EXPENSE",
    frequency: row.frequency,
    dayOfRecurrence: row.dayOfRecurrence,
    accountName: row.account.name,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-on-surface">Contas Bancárias e Cartões</h1>
          <p className="text-sm text-on-surface-variant">{accounts.length} conta(s) ativa(s).</p>
        </div>
        <div className="flex items-center gap-2">
          {accounts.length > 0 && <AuditBalancesButton />}
          <NewAccountButton />
        </div>
      </div>

      {accounts.length === 0 ? (
        <EmptyState
          icon={Landmark}
          title="Nenhuma conta cadastrada"
          description="Crie sua primeira conta pelo botão Nova conta ou importe um extrato."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {accounts.map((account) => (
            <AccountCard key={account.id} account={account} payerAccounts={payerAccounts} />
          ))}
        </div>
      )}

      <ScheduledPanel scheduled={scheduled} accounts={payerAccounts} />
    </div>
  );
}
