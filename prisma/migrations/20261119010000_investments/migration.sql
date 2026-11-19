-- CreateEnum
CREATE TYPE "TradeSide" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED', 'ERROR');

-- AlterEnum
-- Requer PostgreSQL 12+ (vários valores no mesmo enum numa migração).


ALTER TYPE "SyncProvider" ADD VALUE 'B3_XLSX';
ALTER TYPE "SyncProvider" ADD VALUE 'BROKERAGE_NOTE_PDF';
ALTER TYPE "SyncProvider" ADD VALUE 'PLUGGY';

-- CreateTable
CREATE TABLE "investment_trades" (
    "id" TEXT NOT NULL,
    "tradeDate" DATE NOT NULL,
    "side" "TradeSide" NOT NULL,
    "ticker" TEXT NOT NULL,
    "market" TEXT,
    "broker" TEXT,
    "quantity" INTEGER NOT NULL,
    "price" DECIMAL(14,4) NOT NULL,
    "grossAmount" DECIMAL(14,2) NOT NULL,
    "fees" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "source" "SyncProvider" NOT NULL,
    "matchKey" TEXT NOT NULL,
    "brokerageNoteId" TEXT,
    "syncLogId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "investment_trades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brokerage_notes" (
    "id" TEXT NOT NULL,
    "broker" TEXT NOT NULL,
    "noteNumber" TEXT NOT NULL,
    "tradeDate" DATE NOT NULL,
    "settlementFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "registrationFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "emoluments" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "brokerage" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "taxes" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "otherFees" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalFees" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "irrf" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(14,2) NOT NULL,
    "settlementDate" DATE,
    "syncLogId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brokerage_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investment_connections" (
    "id" TEXT NOT NULL,
    "provider" "SyncProvider" NOT NULL,
    "label" TEXT NOT NULL,
    "encryptedRef" TEXT NOT NULL,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "investment_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "investment_trades_matchKey_key" ON "investment_trades"("matchKey");

-- CreateIndex
CREATE INDEX "investment_trades_tradeDate_idx" ON "investment_trades"("tradeDate");

-- CreateIndex
CREATE INDEX "investment_trades_ticker_tradeDate_idx" ON "investment_trades"("ticker", "tradeDate");

-- CreateIndex
CREATE INDEX "brokerage_notes_tradeDate_idx" ON "brokerage_notes"("tradeDate");

-- CreateIndex
CREATE UNIQUE INDEX "brokerage_notes_broker_noteNumber_key" ON "brokerage_notes"("broker", "noteNumber");

-- AddForeignKey
ALTER TABLE "investment_trades" ADD CONSTRAINT "investment_trades_brokerageNoteId_fkey" FOREIGN KEY ("brokerageNoteId") REFERENCES "brokerage_notes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_trades" ADD CONSTRAINT "investment_trades_syncLogId_fkey" FOREIGN KEY ("syncLogId") REFERENCES "sync_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brokerage_notes" ADD CONSTRAINT "brokerage_notes_syncLogId_fkey" FOREIGN KEY ("syncLogId") REFERENCES "sync_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

