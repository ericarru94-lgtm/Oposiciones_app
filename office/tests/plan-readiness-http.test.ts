// Fase 5.2.1 · Paso B1: planSchemaReady con la librería REAL de Supabase.
// Nada de clientes simulados: @supabase/supabase-js y @supabase/ssr hacen
// peticiones HTTP reales a un servidor local que responde como PostgREST.
// Solo una respuesta positiva y válida da LISTA; todo lo demás, NO LISTA.
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGRST205, closedPortUrl, json, notFoundTable, startFakePostgrest, tableOk, type FakePostgrest } from "./helpers/fake-postgrest";

vi.mock("server-only", () => ({}));

import { isPositivePlanProbe, planSchemaReady } from "@/lib/data/plan-readiness";

const KEY = "sb_publishable_prueba_local";
let pg: FakePostgrest;
const client = (url = pg.url) => createClient(url, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
// El mismo tipo de cliente que usa la app en el servidor (sesión del usuario).
const sessionClient = (url = pg.url) => createServerClient(url, KEY, { cookies: { getAll: () => [], setAll: () => {} } });

beforeAll(async () => {
  pg = await startFakePostgrest();
});
afterAll(async () => {
  await pg.close();
});
beforeEach(() => {
  pg.seen.length = 0;
});

describe("causa raíz (documentada con la librería real)", () => {
  it("HEAD a una tabla inexistente: 404 sin cuerpo y postgrest-js devuelve error = null (el fallo original)", async () => {
    pg.setHandler(notFoundTable);
    const res = await client().from("mission_plans").select("id", { head: true, count: "exact" });
    expect(pg.seen[0].method).toBe("HEAD");
    expect(res.error).toBeNull();
    expect(res.status).toBe(204);
  });

  it("GET a la misma tabla inexistente: la librería sí devuelve el error PGRST205", async () => {
    pg.setHandler(notFoundTable);
    const res = await client().from("mission_plans").select("id", { count: "exact" }).limit(0);
    expect(res.status).toBe(404);
    expect(res.error).toMatchObject({ code: "PGRST205" });
  });
});

describe("la consulta que hace planSchemaReady", () => {
  it("es un GET normal (sin HEAD) de una columna y cero filas, con recuento exacto", async () => {
    pg.setHandler(tableOk(0));
    expect(await planSchemaReady(sessionClient())).toBe(true);
    expect(pg.seen).toHaveLength(1);
    const r = pg.seen[0];
    expect(r.method).toBe("GET");
    expect(r.path).toBe("/rest/v1/mission_plans");
    expect(r.query.get("select")).toBe("id");
    expect(r.query.get("limit")).toBe("0");
    expect(String(r.headers.prefer)).toContain("count=exact");
    expect(r.headers.apikey).toBe(KEY);
  });
});

describe("casos obligatorios (cliente de sesión real, @supabase/ssr)", () => {
  const cases: [string, Parameters<FakePostgrest["setHandler"]>[0], boolean][] = [
    ["404 · la tabla no existe (PGRST205)", notFoundTable, false],
    ["404 sin cuerpo", (_q, res) => { res.writeHead(404); res.end(); }, false],
    ["404 con una lista como cuerpo (arreglo de postgrest-js que la convierte en 200 [])", (_q, res) => json(res, 404, []), false],
    ["200 · la tabla existe y tiene planes", tableOk(3), true],
    ["206 · la tabla existe (respuesta parcial con recuento)", tableOk(3, 206), true],
    ["200 · la tabla existe y está vacía", tableOk(0), true],
    ["401 · sin autorización", (_q, res) => json(res, 401, { code: "PGRST301", details: null, hint: null, message: "JWT expired" }), false],
    ["403 · prohibido", (_q, res) => json(res, 403, { code: "PGRST302", details: null, hint: null, message: "Anonymous access is disabled" }), false],
    ["RLS / permisos (42501)", (_q, res) => json(res, 403, { code: "42501", details: null, hint: null, message: "permission denied for table mission_plans" }), false],
    ["500 · error del servidor", (_q, res) => json(res, 500, { code: "XX000", details: null, hint: null, message: "internal error" }), false],
    ["respuesta inesperada · HTML", (_q, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end("<html>proxy</html>"); }, false],
    ["respuesta inesperada · objeto en vez de lista", (_q, res) => json(res, 200, { ok: true }, { "content-range": "*/0" }), false],
    ["respuesta inesperada · cuerpo vacío", (_q, res) => { res.writeHead(200, { "content-range": "*/0" }); res.end(); }, false],
    ["respuesta inesperada · filas pese a limit=0", (_q, res) => json(res, 200, [{ id: "x" }], { "content-range": "0-0/1" }), false],
    ["respuesta inesperada · 200 [] sin Content-Range (sin evidencia de PostgREST)", (_q, res) => json(res, 200, []), false],
    ["respuesta inesperada · Content-Range sin total", (_q, res) => json(res, 200, [], { "content-range": "*/*" }), false],
    ["204 sin contenido", (_q, res) => { res.writeHead(204); res.end(); }, false],
  ];
  for (const [name, handler, expected] of cases) {
    it(`${name} → ${expected ? "LISTA" : "NO LISTA"}`, async () => {
      pg.setHandler(handler);
      expect(await planSchemaReady(sessionClient())).toBe(expected);
      expect(pg.seen.map((r) => r.method)).not.toContain("HEAD");
    });
  }

  it("también con el cliente de supabase-js (createClient): 404 → NO LISTA y 200 → LISTA", async () => {
    pg.setHandler(notFoundTable);
    expect(await planSchemaReady(client())).toBe(false);
    pg.setHandler(tableOk(0));
    expect(await planSchemaReady(client())).toBe(true);
  });

  it("503 repetido (PostgREST sin caché del esquema; la librería reintenta) → NO LISTA dentro del tiempo límite", async () => {
    pg.setHandler((_q, res) => json(res, 503, { code: "PGRST002", details: null, hint: null, message: "Could not query the database for the schema cache. Retrying." }, { "retry-after": "0" }));
    const t0 = Date.now();
    expect(await planSchemaReady(sessionClient(), { timeoutMs: 1_500 })).toBe(false);
    expect(Date.now() - t0).toBeLessThan(5_000);
  });

  it("error de conexión (nadie escucha en el puerto) → NO LISTA", async () => {
    const url = await closedPortUrl();
    expect(await planSchemaReady(sessionClient(url), { timeoutMs: 3_000 })).toBe(false);
  });

  it("tiempo agotado (el servidor no responde nunca) → NO LISTA y la petición se cancela", async () => {
    pg.setHandler(() => { /* sin respuesta */ });
    const t0 = Date.now();
    expect(await planSchemaReady(sessionClient(), { timeoutMs: 300 })).toBe(false);
    const ms = Date.now() - t0;
    expect(ms).toBeGreaterThanOrEqual(250);
    expect(ms).toBeLessThan(3_000);
  });

  it("el tiempo límite por defecto es finito (5 s)", async () => {
    const { PLAN_PROBE_TIMEOUT_MS } = await import("@/lib/data/plan-readiness");
    expect(PLAN_PROBE_TIMEOUT_MS).toBe(5_000);
  });
});

describe("falla cerrado ante cualquier ambigüedad", () => {
  it("una excepción al construir o lanzar la consulta → NO LISTA", async () => {
    const boom = { from: () => { throw new Error("red"); } };
    expect(await planSchemaReady(boom as never)).toBe(false);
    const rejects = { from: () => ({ select: () => ({ limit: () => ({ abortSignal: () => Promise.reject(new Error("caída")) }) }) }) };
    expect(await planSchemaReady(rejects as never)).toBe(false);
  });

  it("isPositivePlanProbe solo acepta la forma exacta de una respuesta correcta", () => {
    const ok = { error: null, data: [], count: 0, status: 200 };
    expect(isPositivePlanProbe(ok)).toBe(true);
    expect(isPositivePlanProbe({ ...ok, status: 206, count: 7 })).toBe(true);
    for (const bad of [
      null, undefined, "x", {},
      { ...ok, error: PGRST205 }, { ...ok, error: undefined }, { ...ok, error: {} },
      { ...ok, status: 204 }, { ...ok, status: 404 }, { ...ok, status: 0 },
      { ...ok, data: null }, { ...ok, data: {} }, { ...ok, data: [{}] },
      { ...ok, count: null }, { ...ok, count: -1 }, { ...ok, count: 1.5 }, { ...ok, count: Number.NaN }, { ...ok, count: "0" },
    ]) {
      expect(isPositivePlanProbe(bad)).toBe(false);
    }
  });
});
