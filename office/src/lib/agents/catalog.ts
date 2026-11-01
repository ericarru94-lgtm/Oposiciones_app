// Catálogo PÚBLICO de la oficina: departamentos, modelos y precios, rasgos de
// los avatares y agentes del piloto. Lo pueden importar los componentes del
// navegador. Las definiciones completas de los agentes (con sus instrucciones
// internas) están en registry.ts, que solo debe usarse en el servidor.

export const DEPARTMENTS = {
  direccion: { name: "Dirección", color: "#2747F5" },
  comercial: { name: "Comercial", color: "#FF4B2B" },
  marketing: { name: "Marketing", color: "#F5B800" },
  contenidos: { name: "Contenidos", color: "#8B5CF6" },
  creatividad: { name: "Creatividad", color: "#EC4899" },
  automatizacion: { name: "Automatización e IA", color: "#06B6D4" },
  clientes: { name: "Atención al cliente", color: "#12B76A" },
  finanzas: { name: "Finanzas y datos", color: "#64748B" },
  calidad: { name: "Control de calidad", color: "#E4E7EC" },
} as const;
export type DepartmentId = keyof typeof DEPARTMENTS;

// Precios oficiales de Anthropic por millón de tokens, verificados el
// 30/10/2026 en platform.claude.com/docs/en/models/*/overview. Escritura de
// caché (TTL 5 min) = 1,25× la entrada. Lectura de caché: 5 % de la entrada en
// Opus 5.5 y Sonnet 5.5, 10 % en Haiku 5.5. Haiku 5.5 tiene un segundo tramo
// cuando el prompt supera 100.000 tokens.
export const MODELS = {
  "claude-opus-5-5": {
    label: "Claude Opus 5.5",
    inputUsdPerMTok: 4,
    outputUsdPerMTok: 20,
    cacheReadUsdPerMTok: 0.2,
    longContext: null,
  },
  "claude-sonnet-5-5": {
    label: "Claude Sonnet 5.5",
    inputUsdPerMTok: 2,
    outputUsdPerMTok: 10,
    cacheReadUsdPerMTok: 0.1,
    longContext: null,
  },
  "claude-haiku-5-5": {
    label: "Claude Haiku 5.5",
    inputUsdPerMTok: 0.1,
    outputUsdPerMTok: 0.5,
    cacheReadUsdPerMTok: 0.01,
    longContext: { thresholdTokens: 100_000, inputUsdPerMTok: 0.5, outputUsdPerMTok: 2.5 },
  },
} as const satisfies Record<string, ModelPricing>;

export interface ModelPricing {
  label: string;
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
  cacheReadUsdPerMTok: number;
  longContext: { thresholdTokens: number; inputUsdPerMTok: number; outputUsdPerMTok: number } | null;
}
export type ModelId = keyof typeof MODELS;
export const DEFAULT_MODEL: ModelId = "claude-opus-5-5";

export type Effort = "low" | "medium" | "high";

/** Rasgos del personaje original (se usan en el avatar 2D y en la oficina 3D). */
export interface AvatarSpec {
  skin: string;
  hair: string;
  hairStyle: "short" | "buzz" | "curly" | "bun" | "long" | "ponytail" | "wavy" | "side";
  outfit: string;
  accent: string;
  accessory: "none" | "glasses" | "headset" | "earring" | "watch";
}

/** Agentes que trabajan de verdad en el piloto. El resto aún no se ejecuta. */
export const PILOT_AGENT_IDS = ["alex", "marcus", "sofia"] as const;
