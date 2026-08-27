-- AlterTable
ALTER TABLE "Usuario" ADD COLUMN     "stripeCustomerId" TEXT,
ADD COLUMN     "stripeSubscriptionId" TEXT,
ADD COLUMN     "stripeSubscriptionStatus" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_stripeCustomerId_key" ON "Usuario"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_stripeSubscriptionId_key" ON "Usuario"("stripeSubscriptionId");
