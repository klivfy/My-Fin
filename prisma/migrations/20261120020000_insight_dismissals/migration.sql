-- CreateTable
CREATE TABLE "insight_dismissals" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insight_dismissals_pkey" PRIMARY KEY ("id")
);

-- Toda tabela nova fecha a Data API do Supabase (ver 20261119020000_enable_rls).
ALTER TABLE "insight_dismissals" ENABLE ROW LEVEL SECURITY;
