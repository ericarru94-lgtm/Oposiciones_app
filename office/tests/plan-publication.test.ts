// Fase 5.2.1 · Ventana de publicación (comprobación D): el código nuevo se
// publica antes de aplicar 0013. Mientras falte la tabla del plan, no se
// pueden crear encargos (ni desde la acción ni desde el formulario).
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn((url: string) => { throw new Error(`REDIRECT ${url}`); }) }));
vi.mock("@/lib/auth/session", () => ({ requireViewer: vi.fn(async () => ({ mode: "admin", userId: "11111111-1111-1111-1111-111111111111" })) }));

const calls: string[] = [];
let planTable: "missing" | "ok" | "throws" = "missing";
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from(table: string) {
      const chain = {
        select(_c: string, opts?: { head?: boolean }) {
          if (table === "mission_plans" && opts?.head) {
            calls.push("probe");
            if (planTable === "throws") throw new Error("red");
            return Promise.resolve({ error: planTable === "missing" ? { message: "Could not find the table 'public.mission_plans'" } : null, count: 0 });
          }
          return chain;
        },
        eq() { return chain; },
        maybeSingle: async () => ({ data: null }),
        insert(row: unknown) { calls.push(`insert:${table}`); void row; return { select: () => ({ single: async () => ({ data: { id: "22222222-2222-2222-2222-222222222222" }, error: null }) }) }; },
      };
      return chain;
    },
  }),
}));

import { createMission } from "@/app/actions/missions";
import { PLAN_SCHEMA_NOT_READY, planSchemaReady } from "@/lib/data/plan-readiness";

const form = () => {
  const f = new FormData();
  f.set("title", "Estudio gimnasios");
  f.set("description", "Estudio comercial en borrador, sin contactar a nadie.");
  f.set("nonce", "3f2b6c1e-8d4a-4b7e-9c2d-5a1e7f9b3c4d");
  return f;
};

beforeEach(() => { calls.length = 0; });

describe("ventana entre el despliegue del código y la migración 0013", () => {
  it("sin la tabla del plan no se crea ningún encargo (nada se inserta)", async () => {
    planTable = "missing";
    expect(await createMission({ message: null }, form())).toEqual({ message: PLAN_SCHEMA_NOT_READY });
    expect(calls).toEqual(["probe"]);
  });

  it("falla cerrado: un error al comprobarlo también bloquea", async () => {
    planTable = "throws";
    expect(await createMission({ message: null }, form())).toEqual({ message: PLAN_SCHEMA_NOT_READY });
    expect(calls.filter((c) => c.startsWith("insert"))).toEqual([]);
  });

  it("con 0013 aplicada se crea el encargo con normalidad", async () => {
    planTable = "ok";
    await expect(createMission({ message: null }, form())).rejects.toThrow(/REDIRECT \/tareas\//);
    expect(calls).toEqual(["probe", "insert:tasks", "insert:activity_log"]);
  });

  it("planSchemaReady solo es true si la consulta a mission_plans responde sin error", async () => {
    const probe = (error: unknown) => ({ from: () => ({ select: () => Promise.resolve({ error }) }) });
    expect(await planSchemaReady(probe(null))).toBe(true);
    expect(await planSchemaReady(probe({ message: "relation does not exist" }))).toBe(false);
  });
});
