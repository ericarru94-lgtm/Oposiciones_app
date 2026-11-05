// Fase 5.2.1 · Ventana de publicación (comprobación D): el código nuevo se
// publica antes de aplicar 0013. Mientras falte la tabla del plan, no se
// pueden crear encargos (ni desde la acción ni desde el formulario).
//
// Paso B1: aquí ya no se simula el cliente de Supabase. La acción y la página
// usan el cliente REAL de @supabase/ssr contra un servidor local que responde
// como PostgREST; así se prueba lo que de verdad devuelve la librería.
import { createServerClient } from "@supabase/ssr";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { json, notFoundTable, startFakePostgrest, tableOk, type FakePostgrest, type Handler } from "./helpers/fake-postgrest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn((url: string) => { throw new Error(`REDIRECT ${url}`); }) }));
vi.mock("@/lib/auth/session", () => ({ requireViewer: vi.fn(async () => ({ mode: "admin", userId: "11111111-1111-1111-1111-111111111111" })) }));
vi.mock("@/lib/data/missions", () => ({ listMissions: vi.fn(async () => []) }));
vi.mock("@/lib/data/budget", () => ({ getBudgetStatus: vi.fn(async () => null) }));
vi.mock("@/lib/env", () => ({ integrationStatus: () => [{ id: "anthropic", configured: true }] }));

let pg: FakePostgrest;
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () =>
    createServerClient(pg.url, "sb_publishable_prueba_local", { cookies: { getAll: () => [], setAll: () => {} } }),
}));

import { createMission } from "@/app/actions/missions";
import { PLAN_SCHEMA_NOT_READY } from "@/lib/data/plan-readiness";
import TasksPage from "@/app/(office)/tareas/page";
import { MissionForm } from "@/app/(office)/tareas/mission-form";

/** PostgREST local: tareas y actividad normales; mission_plans según el caso. */
const office = (plans: Handler): Handler => (req, res) => {
  if (req.path === "/rest/v1/mission_plans") return plans(req, res);
  if (req.path === "/rest/v1/tasks" && req.method === "GET") return json(res, 200, []); // sin encargo previo con ese nonce
  if (req.path === "/rest/v1/tasks" && req.method === "POST") return json(res, 201, { id: "22222222-2222-2222-2222-222222222222" });
  if (req.path === "/rest/v1/activity_log" && req.method === "POST") { res.writeHead(201); res.end(); return; }
  json(res, 404, { code: "PGRST205", details: null, hint: null, message: `Could not find the table '${req.path}'` });
};
const writes = () => pg.seen.filter((r) => r.method === "POST" || r.method === "PATCH" || r.method === "DELETE");
const probes = () => pg.seen.filter((r) => r.path === "/rest/v1/mission_plans");

const form = () => {
  const f = new FormData();
  f.set("title", "Estudio gimnasios");
  f.set("description", "Estudio comercial en borrador, sin contactar a nadie.");
  f.set("nonce", "3f2b6c1e-8d4a-4b7e-9c2d-5a1e7f9b3c4d");
  return f;
};

/** Busca el formulario de encargos en el árbol que devuelve la página. */
function findMissionForm(node: ReactNode): ReactElement<{ disabled: boolean; reason: string | null }> | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const f = findMissionForm(n);
      if (f) return f;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  if (node.type === MissionForm) return node as ReactElement<{ disabled: boolean; reason: string | null }>;
  return findMissionForm((node.props as { children?: ReactNode }).children);
}

beforeAll(async () => {
  pg = await startFakePostgrest();
});
afterAll(async () => {
  await pg.close();
});
beforeEach(() => {
  pg.seen.length = 0;
});

const blocked: [string, Handler][] = [
  ["404 · falta la tabla (PGRST205)", notFoundTable],
  ["401", (_q, res) => json(res, 401, { code: "PGRST301", details: null, hint: null, message: "JWT expired" })],
  ["403 · RLS (42501)", (_q, res) => json(res, 403, { code: "42501", details: null, hint: null, message: "permission denied for table mission_plans" })],
  ["500", (_q, res) => json(res, 500, { code: "XX000", details: null, hint: null, message: "error" })],
  ["respuesta inesperada (HTML)", (_q, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end("<html></html>"); }],
];

describe("acción createMission (librería real)", () => {
  for (const [name, plans] of blocked) {
    it(`${name}: no se crea ningún encargo (ninguna escritura)`, async () => {
      pg.setHandler(office(plans));
      expect(await createMission({ message: null }, form())).toEqual({ message: PLAN_SCHEMA_NOT_READY });
      expect(probes().map((r) => r.method)).toEqual(["GET"]);
      expect(writes()).toEqual([]);
    });
  }

  it("con 0013 aplicada (200 con recuento) se crea el encargo con normalidad", async () => {
    pg.setHandler(office(tableOk(0)));
    await expect(createMission({ message: null }, form())).rejects.toThrow(/REDIRECT \/tareas\/22222222-2222-2222-2222-222222222222/);
    expect(writes().map((r) => `${r.method} ${r.path}`)).toEqual(["POST /rest/v1/tasks", "POST /rest/v1/activity_log"]);
    const task = JSON.parse(writes()[0].body);
    expect(task).toMatchObject({ agent_id: "alex", status: "assigned", input: { kind: "mission", phase: "planning", round: 1 } });
  });

  it("si la comprobación no puede confirmarse a tiempo, también se bloquea", async () => {
    pg.setHandler(office(() => { /* sin respuesta */ }));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const p = createMission({ message: null }, form());
      await vi.waitFor(() => expect(probes()).toHaveLength(1));
      await vi.advanceTimersByTimeAsync(5_001);
      expect(await p).toEqual({ message: PLAN_SCHEMA_NOT_READY });
    } finally {
      vi.useRealTimers();
    }
    expect(writes()).toEqual([]);
  });
});

describe("formulario de /tareas (librería real)", () => {
  for (const [name, plans] of blocked) {
    it(`${name}: el formulario queda desactivado con el aviso`, async () => {
      pg.setHandler(office(plans));
      const f = findMissionForm(await TasksPage());
      expect(f?.props).toEqual({ disabled: true, reason: PLAN_SCHEMA_NOT_READY });
    });
  }

  it("con 0013 aplicada el formulario se activa", async () => {
    pg.setHandler(office(tableOk(2)));
    const f = findMissionForm(await TasksPage());
    expect(f?.props).toEqual({ disabled: false, reason: null });
    expect(probes().map((r) => r.method)).toEqual(["GET"]);
  });
});
