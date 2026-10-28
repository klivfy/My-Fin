-- CreateEnum
CREATE TYPE "CategoryNature" AS ENUM ('NEED', 'WANT', 'SAVINGS');

-- CreateEnum
CREATE TYPE "CategorizationSource" AS ENUM ('MANUAL', 'RULE', 'AI');

-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "nature" "CategoryNature";

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "categorizationSource" "CategorizationSource";

-- CreateTable
CREATE TABLE "categorization_rules" (
    "id" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categorization_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categorization_rules_pattern_key" ON "categorization_rules"("pattern");

-- CreateIndex
CREATE INDEX "categorization_rules_categoryId_idx" ON "categorization_rules"("categoryId");

-- AddForeignKey
ALTER TABLE "categorization_rules" ADD CONSTRAINT "categorization_rules_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: categorias já atribuídas antes desta migração vieram do usuário
-- (ou do seed), nunca de regra/IA.
UPDATE "transactions" SET "categorizationSource" = 'MANUAL' WHERE "categoryId" IS NOT NULL;
