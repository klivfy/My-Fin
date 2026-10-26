import { Landmark, PiggyBank, CreditCard as CreditCardIcon, TrendingUp, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Money } from "@/components/money";
import { AdjustBalanceDialog } from "@/components/accounts/adjust-balance-dialog";
import { AccountActions } from "@/components/accounts/account-form-dialog";
import { CreditCardModule } from "@/components/accounts/credit-card-module";
import type { AccountView } from "@/lib/queries/accounts";

const TYPE_ICON = {
  CHECKING: Landmark,
  SAVINGS: PiggyBank,
  CREDIT_CARD: CreditCardIcon,
  INVESTMENT: TrendingUp,
  CASH: Wallet,
} as const;

const TYPE_LABEL: Record<AccountView["type"], string> = {
  CHECKING: "Conta corrente",
  SAVINGS: "Poupança",
  CREDIT_CARD: "Cartão de crédito",
  INVESTMENT: "Investimento",
  CASH: "Dinheiro",
};

export function AccountCard({
  account,
  payerAccounts,
}: {
  account: AccountView;
  payerAccounts: Array<{ id: string; name: string }>;
}) {
  const Icon = TYPE_ICON[account.type];
  const isCreditCard = account.type === "CREDIT_CARD";

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-full bg-surface-container-high">
            <Icon className="size-4 text-on-surface-variant" />
          </div>
          <div>
            <CardTitle className="text-sm font-medium">{account.name}</CardTitle>
            <p className="text-xs text-on-surface-variant">{TYPE_LABEL[account.type]}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {!isCreditCard && <AdjustBalanceDialog accountId={account.id} currentBalance={account.currentBalance} />}
          <AccountActions
            account={{
              id: account.id,
              name: account.name,
              type: account.type,
              creditLimit: account.creditLimit,
              closingDay: account.closingDay,
              dueDay: account.dueDay,
            }}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Money
          value={account.currentBalance}
          tone={isCreditCard ? "expense" : "neutral"}
          showSign={false}
          className="text-2xl"
        />

        {isCreditCard && account.creditCard && (
          <CreditCardModule
            creditCard={account.creditCard}
            currentBalance={account.currentBalance}
            creditLimit={account.creditLimit}
            payerAccounts={payerAccounts}
          />
        )}
      </CardContent>
    </Card>
  );
}
