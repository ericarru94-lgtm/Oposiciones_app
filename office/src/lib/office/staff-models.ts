// Modelos 3D (GLB) de los trabajadores. Solo presentación: no cambia estados
// ni datos. Un agente sin entrada aquí sigue usando la figura generada por código.
//
// Fase 4.2 · PRUEBA con 3 personajes (Alex, Marcus y Sofia). Origen y licencia
// de cada archivo en `public/models/equipo/LICENCIAS.md`.

export interface StaffModel {
  /** Ruta servida por la propia app (sin URLs externas en tiempo de ejecución). */
  url: string;
  /** Altura del modelo, en metros, tal como viene en el archivo. */
  height: number;
  /** Escala del modelo en el puesto (1 = tamaño real del archivo). La silla se escala a 0,85 × este valor para que el asiento encaje con la cadera. */
  scale: number;
  /**
   * Colores (sRGB) que sustituyen a materiales del modelo por nombre, para la identidad del puesto.
   * Ojo: los nombres son del autor, no describen la pieza (en «marcus», `LightBrown` es la camisa y
   * `LightBlue` el pantalón; en «sofia», `White` es la blusa y `Orange` el pantalón).
   */
  tint?: Record<string, string>;
}

export const STAFF_MODELS: Readonly<Record<string, StaffModel>> = {
  alex: { url: "/models/equipo/alex.glb", height: 1.86, scale: 1.15, tint: { Suit: "#1d2638", Tie: "#2747f5", White: "#e9edf4" } },
  marcus: { url: "/models/equipo/marcus.glb", height: 1.86, scale: 1.15, tint: { LightBrown: "#b5402a", LightBlue: "#2c3648", Red_Dark: "#3b2a20" } },
  sofia: { url: "/models/equipo/sofia.glb", height: 1.8, scale: 1.15, tint: { White: "#e0a800", Orange: "#262c3a", Grey: "#15181f" } },
};

/** «?modelos=no» vuelve a las figuras generadas por código (comparación y desactivación rápida). */
function modelsDisabled(): boolean {
  return typeof window !== "undefined" && new URLSearchParams(window.location.search).get("modelos") === "no";
}

export function staffModelOf(agentId: string): StaffModel | undefined {
  if (modelsDisabled()) return undefined;
  return Object.hasOwn(STAFF_MODELS, agentId) ? STAFF_MODELS[agentId] : undefined;
}
