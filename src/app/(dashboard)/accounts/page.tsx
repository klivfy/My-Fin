import { Landmark } from "lucide-react";
import { listAccountViews } from "@/lib/queries/accounts";
import { AccountCard } from "@/components/accounts/account-card";
import { AuditBalancesButton } from "@/components/accounts/audit-balances-button";
import { EmptyState } from "@/components/dashboard/empty-state";

export default async function AccountsPage() {
  const accounts = await listAccountViews();
  const payerAccounts = accounts
    .filter((a) => a.type !== "CREDIT_CARD")
    .map((a) => ({ id: a.id, name: a.name }));

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-on-surface">Contas Bancárias e Cartões</h1>
          <p className="text-sm text-on-surface-variant">{accounts.length} conta(s) ativa(s).</p>
        </div>
        {accounts.length > 0 && <AuditBalancesButton />}
      </div>

      {accounts.length === 0 ? (
        <EmptyState
          icon={Landmark}
          title="Nenhuma conta cadastrada"
          description="Contas são criadas ao importar um extrato ou lançar a primeira transação."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {accounts.map((account) => (
            <AccountCard key={account.id} account={account} payerAccounts={payerAccounts} />
          ))}
        </div>
      )}
    </div>
  );
}
