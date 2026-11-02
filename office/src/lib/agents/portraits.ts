// Retratos de los trabajadores: única fuente de verdad para su cara en la interfaz
// (lista, ficha lateral y página de cada empleado). Seguro para el cliente: solo
// rutas de imágenes estáticas, sin datos internos de los agentes.
//
// Cada retrato se renderiza desde el modelo 3D aprobado del propio trabajador
// (LOD0), así que su cara coincide con la de la oficina 3D.
// Proceso: docs/FASE-432-AVATARES.md · licencia: public/models/equipo/LICENCIAS.md.

/** «realista»: retrato del modelo aprobado. «pendiente»: aún sin modelo; se usa el avatar dibujado. */
export type PortraitStatus = "realista" | "pendiente";

export interface AgentPortrait {
  /** Imagen estática servida por la propia app (WebP con transparencia, sin metadatos). */
  src: string;
  width: number;
  height: number;
  /** Modelo 3D del que procede el retrato (para comprobar que coinciden). */
  model: string;
}

const portrait = (id: string): AgentPortrait => ({
  src: `/avatars/equipo/${id}.webp`,
  width: 256,
  height: 256,
  model: `/models/equipo/${id}-realista.glb`,
});

/** Estado del retrato de cada agente, por su identificador estable. */
export const PORTRAIT_STATUS: Readonly<Record<string, PortraitStatus>> = {
  alex: "realista",
  marcus: "realista",
  sofia: "realista",
  daniel: "realista",
  lucia: "realista",
  david: "realista",
  emma: "realista",
  oscar: "realista",
  victoria: "realista",
};

/** Retrato realista del agente, o `null` si todavía no tiene modelo aprobado. */
export function portraitOf(agentId: string): AgentPortrait | null {
  return Object.hasOwn(PORTRAIT_STATUS, agentId) && PORTRAIT_STATUS[agentId] === "realista" ? portrait(agentId) : null;
}
