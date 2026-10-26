-- CreateEnum
CREATE TYPE "RecurrenceFrequency" AS ENUM ('WEEKLY', 'MONTHLY');

-- AlterEnum
ALTER TYPE "SyncProvider" ADD VALUE 'CSV_IMPORT';

-- CreateTable
CREATE TABLE "category_rules" (
    "id" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "category_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "savings_goals" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "targetAmount" DECIMAL(12,2) NOT NULL,
    "targetDate" TIMESTAMP(3) NOT NULL,
    "accountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "savings_goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_transactions" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "categoryId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "type" "TransactionType" NOT NULL,
    "description" TEXT NOT NULL,
    "frequency" "RecurrenceFrequency" NOT NULL,
    "dayOfRecurrence" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "occurrences" INTEGER,
    "generatedCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "category_rules_pattern_categoryId_key" ON "category_rules"("pattern", "categoryId");

-- CreateIndex
CREATE INDEX "category_rules_categoryId_idx" ON "category_rules"("categoryId");

-- CreateIndex
CREATE INDEX "savings_goals_accountId_idx" ON "savings_goals"("accountId");

-- CreateIndex
CREATE INDEX "scheduled_transactions_accountId_isActive_idx" ON "scheduled_transactions"("accountId", "isActive");

-- AddForeignKey
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "savings_goals" ADD CONSTRAINT "savings_goals_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_transactions" ADD CONSTRAINT "scheduled_transactions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_transactions" ADD CONSTRAINT "scheduled_transactions_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
