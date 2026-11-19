import { prisma } from "@/lib/prisma";
import { PrivacyModeProvider } from "@/components/privacy-mode";
import { AppNav } from "@/components/app-nav";
import { TopAppBar } from "@/components/dashboard/top-app-bar";
import { Toaster } from "@/components/ui/sonner";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [accounts, categories, lastSync] = await Promise.all([
    prisma.account.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.category.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, type: true },
    }),
    prisma.syncLog.findFirst({
      orderBy: { createdAt: "desc" },
      select: { status: true, finishedAt: true, provider: true },
    }),
  ]);

  return (
    <PrivacyModeProvider>
      <div className="flex min-h-dvh bg-surface">
        <AppNav />
        <div className="flex min-w-0 flex-1 flex-col pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0">
          <TopAppBar
            lastSync={
              lastSync
                ? { ...lastSync, finishedAt: lastSync.finishedAt?.toISOString() ?? null }
                : null
            }
            accounts={accounts}
            categories={categories}
          />
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
        </div>
      </div>
      <Toaster />
    </PrivacyModeProvider>
  );
}
