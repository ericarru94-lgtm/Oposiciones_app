-- CreateEnum
CREATE TYPE "Bloque" AS ENUM ('I', 'II');

-- CreateEnum
CREATE TYPE "TipoPregunta" AS ENUM ('teorica', 'psicotecnica');

-- CreateEnum
CREATE TYPE "OrigenPregunta" AS ENUM ('examen_oficial', 'generada_ia');

-- CreateEnum
CREATE TYPE "EstadoPregunta" AS ENUM ('borrador', 'verificada', 'anulada');

-- CreateEnum
CREATE TYPE "Opcion" AS ENUM ('a', 'b', 'c', 'd');

-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('free', 'premium');

-- CreateTable
CREATE TABLE "Tema" (
    "id" SERIAL NOT NULL,
    "bloque" "Bloque" NOT NULL,
    "numero" INTEGER NOT NULL,
    "nombre" TEXT NOT NULL,

    CONSTRAINT "Tema_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pregunta" (
    "id" TEXT NOT NULL,
    "temaId" INTEGER,
    "enunciado" TEXT NOT NULL,
    "opciones" JSONB NOT NULL,
    "respuestaCorrecta" "Opcion",
    "explicacion" TEXT,
    "fuente" TEXT,
    "origen" "OrigenPregunta" NOT NULL,
    "convocatoria" TEXT,
    "estado" "EstadoPregunta" NOT NULL DEFAULT 'borrador',
    "fechaVerificacion" TIMESTAMP(3),
    "reportesUsuario" INTEGER NOT NULL DEFAULT 0,
    "tipo" "TipoPregunta" NOT NULL,
    "esPreguntaReserva" BOOLEAN NOT NULL DEFAULT false,
    "numeroOriginalExamen" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pregunta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Usuario" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "nivelInicial" TEXT,
    "plan" "Plan" NOT NULL DEFAULT 'free',
    "premiumHasta" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Progreso" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "preguntaId" TEXT NOT NULL,
    "repeticiones" INTEGER NOT NULL DEFAULT 0,
    "factorFacilidad" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "intervaloDias" INTEGER NOT NULL DEFAULT 0,
    "proximaRevision" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimaRevision" TIMESTAMP(3),
    "ultimaCalidad" INTEGER,
    "vecesVista" INTEGER NOT NULL DEFAULT 0,
    "vecesCorrecta" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Progreso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Intento" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT,
    "sesionAnonima" TEXT,
    "preguntaId" TEXT NOT NULL,
    "opcionElegida" "Opcion",
    "esCorrecta" BOOLEAN NOT NULL,
    "tiempoMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Intento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tema_bloque_numero_key" ON "Tema"("bloque", "numero");

-- CreateIndex
CREATE INDEX "Pregunta_tipo_estado_idx" ON "Pregunta"("tipo", "estado");

-- CreateIndex
CREATE INDEX "Pregunta_temaId_idx" ON "Pregunta"("temaId");

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_email_key" ON "Usuario"("email");

-- CreateIndex
CREATE INDEX "Progreso_usuarioId_proximaRevision_idx" ON "Progreso"("usuarioId", "proximaRevision");

-- CreateIndex
CREATE UNIQUE INDEX "Progreso_usuarioId_preguntaId_key" ON "Progreso"("usuarioId", "preguntaId");

-- CreateIndex
CREATE INDEX "Intento_usuarioId_createdAt_idx" ON "Intento"("usuarioId", "createdAt");

-- CreateIndex
CREATE INDEX "Intento_sesionAnonima_createdAt_idx" ON "Intento"("sesionAnonima", "createdAt");

-- AddForeignKey
ALTER TABLE "Pregunta" ADD CONSTRAINT "Pregunta_temaId_fkey" FOREIGN KEY ("temaId") REFERENCES "Tema"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Progreso" ADD CONSTRAINT "Progreso_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Progreso" ADD CONSTRAINT "Progreso_preguntaId_fkey" FOREIGN KEY ("preguntaId") REFERENCES "Pregunta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Intento" ADD CONSTRAINT "Intento_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Intento" ADD CONSTRAINT "Intento_preguntaId_fkey" FOREIGN KEY ("preguntaId") REFERENCES "Pregunta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
