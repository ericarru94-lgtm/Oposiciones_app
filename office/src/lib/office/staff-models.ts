// Modelos 3D (GLB) de los trabajadores. Solo presentación: no cambia estados
// ni datos. Un agente sin entrada aquí sigue usando la figura generada por código.
//
// Fases 4.3–4.4 · los nueve trabajadores con modelo humano realista (MPFB2 + recursos CC0 de MakeHuman).
// Origen y licencia de cada archivo en `public/models/equipo/LICENCIAS.md`. Tener modelo no activa a nadie:
// la postura y la animación dependen solo del estado real (los agentes fuera del piloto se ven inactivos).

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
  /** Esqueleto del modelo (por defecto, el de Quaternius). */
  rig?: "quaternius" | "makehuman";
  /** Niveles de detalle más ligeros: [LOD1, LOD2]. `url` es el LOD0. */
  lods?: readonly [string, string];
}

const realista = (id: string, height: number): StaffModel => ({
  url: `/models/equipo/${id}-realista.glb`,
  lods: [`/models/equipo/${id}-realista-lod1.glb`, `/models/equipo/${id}-realista-lod2.glb`],
  height,
  scale: 1.12,
  rig: "makehuman",
});

export const STAFF_MODELS: Readonly<Record<string, StaffModel>> = {
  // Generados con scripts/models/mpfb (ficha JSON por personaje). Altura aproximada de pie, en metros.
  alex: realista("alex", 1.83),
  marcus: realista("marcus", 1.83),
  sofia: realista("sofia", 1.72),
  daniel: realista("daniel", 1.82),
  lucia: realista("lucia", 1.68),
  david: realista("david", 1.88),
  emma: realista("emma", 1.68),
  oscar: realista("oscar", 1.8),
  victoria: realista("victoria", 1.72),
};

/** Modelos Quaternius de la fase 4.2, conservados para comparar («?modelos=quaternius»). */
const QUATERNIUS: Readonly<Record<string, StaffModel>> = {
  alex: { url: "/models/equipo/alex.glb", height: 1.86, scale: 1.15, tint: { Suit: "#1d2638", Tie: "#2747f5", White: "#e9edf4" } },
  marcus: { url: "/models/equipo/marcus.glb", height: 1.86, scale: 1.15, tint: { LightBrown: "#b5402a", LightBlue: "#2c3648", Red_Dark: "#3b2a20" } },
  sofia: { url: "/models/equipo/sofia.glb", height: 1.8, scale: 1.15, tint: { White: "#e0a800", Orange: "#262c3a", Grey: "#15181f" } },
};

/** «?modelos=no» vuelve a las figuras por código; «?modelos=quaternius», a los modelos de la fase 4.2. */
function param(name: string): string | null {
  return typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get(name);
}

export function staffModelOf(agentId: string): StaffModel | undefined {
  const mode = param("modelos");
  if (mode === "no") return undefined;
  if (mode === "quaternius") return Object.hasOwn(QUATERNIUS, agentId) ? QUATERNIUS[agentId] : undefined;
  return Object.hasOwn(STAFF_MODELS, agentId) ? STAFF_MODELS[agentId] : undefined;
}
