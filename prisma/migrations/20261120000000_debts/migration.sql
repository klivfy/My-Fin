-- CreateTable
CREATE TABLE "debts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "installment" DECIMAL(12,2) NOT NULL,
    "remaining" INTEGER NOT NULL,
    "monthlyRatePct" DECIMAL(6,3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "debts_pkey" PRIMARY KEY ("id")
);

-- Toda tabela nova fecha a Data API do Supabase (ver 20261119020000_enable_rls).
ALTER TABLE "debts" ENABLE ROW LEVEL SECURITY;
