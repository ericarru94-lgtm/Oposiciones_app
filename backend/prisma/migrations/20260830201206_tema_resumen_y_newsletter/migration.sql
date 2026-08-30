-- CreateEnum
CREATE TYPE "EstadoSuscripcionNewsletter" AS ENUM ('pendiente', 'confirmado', 'baja');

-- AlterTable
ALTER TABLE "Tema" ADD COLUMN     "resumen" TEXT,
ADD COLUMN     "resumenGeneradoIA" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "NewsletterSuscriptor" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "consentimiento" BOOLEAN NOT NULL,
    "fechaConsentimiento" TIMESTAMP(3) NOT NULL,
    "estado" "EstadoSuscripcionNewsletter" NOT NULL DEFAULT 'pendiente',
    "tokenConfirmacion" TEXT NOT NULL,
    "tokenBaja" TEXT NOT NULL,
    "confirmadoEn" TIMESTAMP(3),
    "bajaEn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NewsletterSuscriptor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NewsletterSuscriptor_email_key" ON "NewsletterSuscriptor"("email");

-- CreateIndex
CREATE UNIQUE INDEX "NewsletterSuscriptor_tokenConfirmacion_key" ON "NewsletterSuscriptor"("tokenConfirmacion");

-- CreateIndex
CREATE UNIQUE INDEX "NewsletterSuscriptor_tokenBaja_key" ON "NewsletterSuscriptor"("tokenBaja");
