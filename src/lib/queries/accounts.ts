import { prisma } from "@/lib/prisma";
import { parseAccountMetadata } from "@/lib/account-metadata";

export interface InvoiceSummary {
  id: string;
  closingDate: string;
  dueDate: string;
  totalAmount: string;
  status: "OPEN" | "CLOSED" | "PAID";
}

export interface InstallmentGroupSummary {
  rootId: string;
  description: string;
  installmentAmount: string;
  totalInstallments: number;
  paidCount: number;
}

export interface CreditCardView {
  invoices: InvoiceSummary[];
  installmentGroups: InstallmentGroupSummary[];
}

export interface AccountView {
  id: string;
  name: string;
  type: "CHECKING" | "SAVINGS" | "CREDIT_CARD" | "INVESTMENT" | "CASH";
  currentBalance: string;
  creditLimit: string | null;
  creditCard: CreditCardView | null;
}

export async function listAccountViews(): Promise<AccountView[]> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const accounts = await prisma.account.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });

  const creditCardAccounts = accounts.filter((a) => a.type === "CREDIT_CARD");
  const invoicesByAccount = new Map<string, InvoiceSummary[]>();
  const groupsByAccount = new Map<string, InstallmentGroupSummary[]>();

  if (creditCardAccounts.length > 0) {
    const accountIds = creditCardAccounts.map((a) => a.id);

    const invoices = await prisma.creditCardInvoice.findMany({
      where: { accountId: { in: accountIds }, status: { not: "PAID" } },
      orderBy: { closingDate: "asc" },
    });
    for (const invoice of invoices) {
      const list = invoicesByAccount.get(invoice.accountId) ?? [];
      list.push({
        id: invoice.id,
        closingDate: invoice.closingDate.toISOString(),
        dueDate: invoice.dueDate.toISOString(),
        totalAmount: invoice.totalAmount.toString(),
        status: invoice.status,
      });
      invoicesByAccount.set(invoice.accountId, list);
    }

    const installmentLegs = await prisma.transaction.findMany({
      where: { accountId: { in: accountIds }, totalInstallments: { not: null } },
      orderBy: { date: "asc" },
      select: {
        id: true,
        accountId: true,
        parentTransactionId: true,
        originalDescription: true,
        amount: true,
        date: true,
        totalInstallments: true,
      },
    });

    const groups = new Map<string, { accountId: string; description: string; amount: string; total: number; paid: number }>();
    for (const leg of installmentLegs) {
      const rootId = leg.parentTransactionId ?? leg.id;
      const existing = groups.get(rootId);
      const isPaidLeg = leg.date <= today;
      if (existing) {
        existing.paid += isPaidLeg ? 1 : 0;
      } else {
        groups.set(rootId, {
          accountId: leg.accountId,
          description: leg.originalDescription ?? "Compra parcelada",
          amount: leg.amount.toString(),
          total: leg.totalInstallments ?? 1,
          paid: isPaidLeg ? 1 : 0,
        });
      }
    }
    for (const [rootId, group] of groups) {
      const list = groupsByAccount.get(group.accountId) ?? [];
      list.push({
        rootId,
        description: group.description,
        installmentAmount: group.amount,
        totalInstallments: group.total,
        paidCount: group.paid,
      });
      groupsByAccount.set(group.accountId, list);
    }
  }

  return accounts.map((account) => {
    const metadata = parseAccountMetadata(account.metadata);
    const isCreditCard = account.type === "CREDIT_CARD";
    return {
      id: account.id,
      name: account.name,
      type: account.type,
      currentBalance: account.currentBalance.toString(),
      creditLimit: metadata.creditLimit ?? null,
      creditCard: isCreditCard
        ? {
            invoices: invoicesByAccount.get(account.id) ?? [],
            installmentGroups: groupsByAccount.get(account.id) ?? [],
          }
        : null,
    };
  });
}
