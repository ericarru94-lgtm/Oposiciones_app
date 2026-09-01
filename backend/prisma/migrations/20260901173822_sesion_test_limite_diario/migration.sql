-- CreateTable
CREATE TABLE "SesionTest" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SesionTest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SesionTest_usuarioId_createdAt_idx" ON "SesionTest"("usuarioId", "createdAt");

-- AddForeignKey
ALTER TABLE "SesionTest" ADD CONSTRAINT "SesionTest_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
