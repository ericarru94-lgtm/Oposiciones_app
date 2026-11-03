// Límites económicos de la oficina: validación del servidor.
// Las reglas son las MISMAS que public.settings_value_error('limits', …) de la
// migración 0012, y los techos se leen de public.settings_ceilings() (una sola
// fuente). Una prueba compara este validador con el de PostgreSQL caso a caso.

export type LimitKey = "monthly_ai_budget_usd" | "mission_ai_budget_usd" | "task_ai_budget_usd";
export type Limits = Record<LimitKey, number>;
export type LimitCeilings = Limits;

export const LIMIT_LABEL: Record<LimitKey, string> = {
  monthly_ai_budget_usd: "mensual",
  mission_ai_budget_usd: "por misión",
  task_ai_budget_usd: "por tarea",
};

const KEYS: LimitKey[] = ["monthly_ai_budget_usd", "mission_ai_budget_usd", "task_ai_budget_usd"];

/** Convierte el texto del formulario en número; vacío o ilegible → null (no válido). */
export function parseAmount(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().replace(",", ".");
  if (v === "" || !/^\d+(\.\d+)?$/.test(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** null si los límites son válidos; si no, el motivo para mostrar al administrador. */
export function limitsError(value: Record<LimitKey, number | null>, ceilings: LimitCeilings): string | null {
  for (const k of KEYS) {
    const n = value[k];
    if (n === null || n === undefined || !Number.isFinite(n)) {
      return `El límite ${LIMIT_LABEL[k]} es obligatorio y debe ser un número.`;
    }
    if (n < 0) return `El límite ${LIMIT_LABEL[k]} no puede ser negativo.`;
    if (n > ceilings[k]) return `El límite ${LIMIT_LABEL[k]} no puede superar el máximo aprobado (${ceilings[k]} $).`;
  }
  if (value.task_ai_budget_usd! > value.monthly_ai_budget_usd!) return "El límite por tarea no puede superar el mensual.";
  if (value.mission_ai_budget_usd! > value.monthly_ai_budget_usd!) return "El límite por misión no puede superar el mensual.";
  return null;
}

/** Lee los techos que devuelve settings_ceilings(); null si el formato no es el esperado. */
export function readCeilings(raw: unknown): LimitCeilings | null {
  const limits = (raw as { limits?: Record<string, unknown> } | null)?.limits;
  if (!limits) return null;
  const out = {} as LimitCeilings;
  for (const k of KEYS) {
    const n = Number(limits[k]);
    if (limits[k] === null || limits[k] === undefined || !Number.isFinite(n) || n < 0) return null;
    out[k] = n;
  }
  return out;
}
