-- DropIndex
DROP INDEX "transactions_categoryId_idx";

-- CreateIndex
CREATE INDEX "transactions_date_idx" ON "transactions"("date");

-- CreateIndex
CREATE INDEX "transactions_type_date_idx" ON "transactions"("type", "date");

-- CreateIndex
CREATE INDEX "transactions_categoryId_date_idx" ON "transactions"("categoryId", "date");
