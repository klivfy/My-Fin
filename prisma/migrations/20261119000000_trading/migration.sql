-- CreateEnum
CREATE TYPE "TradeMode" AS ENUM ('REAL', 'SIMULADO');

-- CreateTable
CREATE TABLE "trade_entries" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "entryDate" DATE,
    "ticker" TEXT NOT NULL,
    "assetClass" TEXT,
    "style" TEXT,
    "setup" TEXT,
    "entryPrice" DECIMAL(14,4),
    "stopPrice" DECIMAL(14,4),
    "targetPrice" DECIMAL(14,4),
    "exitPrice" DECIMAL(14,4),
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "costs" DECIMAL(12,2),
    "resultBrl" DECIMAL(12,2),
    "resultR" DECIMAL(10,3),
    "exitReason" TEXT,
    "emotion" TEXT,
    "note" TEXT,
    "mode" "TradeMode" NOT NULL DEFAULT 'REAL',
    "importHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trade_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_limits" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "maxLossDay" DECIMAL(12,2),
    "maxLossMonth" DECIMAL(12,2),
    "pauseDaysAfterMonth" INTEGER,
    "maxTradesDay" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trade_limits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "trade_entries_importHash_key" ON "trade_entries"("importHash");

-- CreateIndex
CREATE INDEX "trade_entries_mode_date_idx" ON "trade_entries"("mode", "date");

