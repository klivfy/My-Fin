-- CreateEnum
CREATE TYPE "Pot" AS ENUM ('NECESSIDADES', 'LIBERDADE', 'LONGO_PRAZO', 'INSTRUCAO', 'DOACOES', 'DIVERSAO');

-- AlterTable
ALTER TABLE "categories" ADD COLUMN "pot" "Pot";

-- CreateTable
CREATE TABLE "pot_allocations" (
    "pot" "Pot" NOT NULL,
    "percent" DECIMAL(5,2) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pot_allocations_pkey" PRIMARY KEY ("pot")
);

-- Toda tabela nova fecha a Data API do Supabase (ver 20261119020000_enable_rls).
ALTER TABLE "pot_allocations" ENABLE ROW LEVEL SECURITY;
