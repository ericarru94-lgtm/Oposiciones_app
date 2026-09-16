-- CreateTable
CREATE TABLE "PreguntaFavorita" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "preguntaId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreguntaFavorita_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PreguntaFavorita_usuarioId_idx" ON "PreguntaFavorita"("usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "PreguntaFavorita_usuarioId_preguntaId_key" ON "PreguntaFavorita"("usuarioId", "preguntaId");

-- AddForeignKey
ALTER TABLE "PreguntaFavorita" ADD CONSTRAINT "PreguntaFavorita_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreguntaFavorita" ADD CONSTRAINT "PreguntaFavorita_preguntaId_fkey" FOREIGN KEY ("preguntaId") REFERENCES "Pregunta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
