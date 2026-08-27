export type Opcion = "a" | "b" | "c" | "d";
export type TipoPregunta = "teorica" | "psicotecnica";
export type Bloque = "I" | "II";
export type Plan = "free" | "premium";

export interface Tema {
  id: number;
  bloque: Bloque;
  numero: number;
  nombre: string;
}

/** Pregunta tal como se sirve al cliente antes de responder: sin la respuesta correcta. */
export interface PreguntaParaResponder {
  id: string;
  enunciado: string;
  opciones: string[];
  tipo: TipoPregunta;
  temaId: number | null;
}

export interface RespuestaFeedback {
  esCorrecta: boolean;
  respuestaCorrecta: Opcion;
  explicacion: string | null;
  fuente: string | null;
  limiteDiario: { restantes: number; usadas: number };
}

export interface Usuario {
  id: string;
  email: string;
  plan: Plan;
  nivelInicial?: string | null;
}

export interface ProgresoHoy {
  limiteDiario: { restantes: number };
  repaso: Array<{ preguntaId: string; enunciado: string; opciones: string[]; tipo: TipoPregunta; esNueva: false }>;
  nuevas: Array<{ preguntaId: string; enunciado: string; opciones: string[]; tipo: TipoPregunta; esNueva: true }>;
}

export interface ProgresoResumen {
  totalIntentos: number;
  aciertos: number;
  precision: number | null;
  preguntasEnSeguimiento: number;
  pendientesHoy: number;
  racha: { dias: number; ultimaActividad: string | null };
}

export interface ProgresoPorTema {
  temaId: number;
  bloque: Bloque;
  numero: number;
  nombre: string;
  totalPreguntas: number;
  preguntasContestadas: number;
  totalIntentos: number;
  aciertos: number;
  precision: number | null;
}

export interface EvolucionDia {
  fecha: string;
  intentos: number;
  aciertos: number;
  precision: number | null;
}
