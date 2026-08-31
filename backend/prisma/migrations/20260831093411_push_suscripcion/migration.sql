-- CreateTable
CREATE TABLE "PushSuscripcion" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSuscripcion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PushSuscripcion_endpoint_key" ON "PushSuscripcion"("endpoint");

-- CreateIndex
CREATE INDEX "PushSuscripcion_usuarioId_idx" ON "PushSuscripcion"("usuarioId");

-- AddForeignKey
ALTER TABLE "PushSuscripcion" ADD CONSTRAINT "PushSuscripcion_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
