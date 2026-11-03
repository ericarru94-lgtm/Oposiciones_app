// Validación del servidor de los límites económicos (fase 5.1.3). La paridad
// exacta con PostgreSQL se prueba en migration-0012; aquí, el texto del
// formulario y los mensajes.
import { describe, expect, it } from "vitest";
import { limitsError, parseAmount, readCeilings } from "@/lib/domain/limits";

const CEIL = { monthly_ai_budget_usd: 10, mission_ai_budget_usd: 1, task_ai_budget_usd: 1 };
const ok = { monthly_ai_budget_usd: 10, mission_ai_budget_usd: 1, task_ai_budget_usd: 1 };

describe("límites económicos", () => {
  it("el formulario no admite vacío («sin límite»), texto ni negativos", () => {
    for (const raw of ["", "  ", "abc", "-1", "1e3", "Infinity", "NaN", "1.2.3", null, undefined, 5]) {
      expect({ raw, n: parseAmount(raw) }).toEqual({ raw, n: null });
    }
    expect(parseAmount("0")).toBe(0);
    expect(parseAmount("0,5")).toBe(0.5);
    expect(parseAmount(" 9.99 ")).toBe(9.99);
  });

  it("obligatorios, no negativos, dentro del techo y coherentes con el mensual", () => {
    expect(limitsError(ok, CEIL)).toBeNull();
    expect(limitsError({ monthly_ai_budget_usd: 0, mission_ai_budget_usd: 0, task_ai_budget_usd: 0 }, CEIL)).toBeNull();
    expect(limitsError({ ...ok, monthly_ai_budget_usd: null }, CEIL)).toMatch(/obligatorio/);
    expect(limitsError({ ...ok, task_ai_budget_usd: -0.01 }, CEIL)).toMatch(/negativo/);
    expect(limitsError({ ...ok, monthly_ai_budget_usd: 10.01 }, CEIL)).toMatch(/máximo aprobado \(10 \$\)/);
    expect(limitsError({ ...ok, mission_ai_budget_usd: 1.5 }, CEIL)).toMatch(/máximo aprobado \(1 \$\)/);
    expect(limitsError({ monthly_ai_budget_usd: 0.5, mission_ai_budget_usd: 0.5, task_ai_budget_usd: 1 }, CEIL)).toMatch(/por tarea no puede superar el mensual/);
    expect(limitsError({ monthly_ai_budget_usd: 0.5, mission_ai_budget_usd: 1, task_ai_budget_usd: 0.5 }, CEIL)).toMatch(/por misión no puede superar el mensual/);
  });

  it("los techos solo se aceptan con el formato de settings_ceilings()", () => {
    expect(readCeilings({ limits: CEIL, pilot: {} })).toEqual(CEIL);
    expect(readCeilings(null)).toBeNull();
    expect(readCeilings({ limits: { ...CEIL, task_ai_budget_usd: null } })).toBeNull();
    expect(readCeilings({ limits: { monthly_ai_budget_usd: 10 } })).toBeNull();
  });
});
