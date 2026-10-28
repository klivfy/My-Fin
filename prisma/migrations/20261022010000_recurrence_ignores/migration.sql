-- CreateTable
CREATE TABLE "recurrence_ignores" (
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recurrence_ignores_pkey" PRIMARY KEY ("key")
);

