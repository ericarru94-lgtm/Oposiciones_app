-- AlterTable
ALTER TABLE "Usuario" ADD COLUMN     "clerkUserId" TEXT,
ALTER COLUMN "passwordHash" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_clerkUserId_key" ON "Usuario"("clerkUserId");
