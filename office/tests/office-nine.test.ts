// La oficina muestra a los nueve trabajadores (fase 5.1.4): los seis fuera del
// piloto aparecen como inactivos en lugar de desaparecer. Solo lectura: esto no
// decide quién trabaja (lo deciden el worker y claim_next_task).
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => { throw new Error("no se usa"); } }));

import { ACTIVE_AGENT_IDS } from "@/lib/agents/catalog";
import { AGENT_IDS } from "@/lib/agents/registry";
import { listAgents, mergeAgents, type AgentRow } from "@/lib/data/agents";
import { toOfficeAgent } from "@/lib/data/office";
import { createTestDb, ADMIN } from "./helpers/db";

// Estado real de producción tras 0009 (consulta de solo lectura del 03/11/2026).
const prodRows = (): AgentRow[] =>
  AGENT_IDS.map((id) => ({
    id, status: "available", status_detail: null, status_updated_at: null, model: "claude-haiku-5-5", current_task_id: null,
    active: (ACTIVE_AGENT_IDS as readonly string[]).includes(id),
  }));

describe("oficina con los nueve trabajadores", () => {
  it("llegan los nueve; solo Alex, Marcus y Sofia cuentan como activos", () => {
    const office = mergeAgents(prodRows(), []).map(toOfficeAgent);
    expect(office.map((a) => a.id).sort()).toEqual([...AGENT_IDS].sort());
    expect(office.filter((a) => a.pilot).map((a) => a.id).sort()).toEqual([...ACTIVE_AGENT_IDS].sort());
    expect(office.filter((a) => !a.pilot)).toHaveLength(6);
  });

  it("activo solo si lo está en el código Y en la base de datos", () => {
    const rows = prodRows().map((r) => (r.id === "alex" ? { ...r, active: false } : r.id === "daniel" ? { ...r, active: true } : r));
    const office = mergeAgents(rows, []).map(toOfficeAgent);
    expect(office.find((a) => a.id === "alex")!.pilot).toBe(false);   // desactivado en la base de datos
    expect(office.find((a) => a.id === "daniel")!.pilot).toBe(false); // activo en la base de datos, pero no en el código
  });

  it("un agente que no existe en la base de datos no aparece, y uno desconocido en la base de datos tampoco", () => {
    const rows = prodRows().filter((r) => r.id !== "victoria");
    rows.push({ ...rows[0], id: "intruso" });
    const ids = mergeAgents(rows, []).map((a) => a.id);
    expect(ids).not.toContain("victoria");
    expect(ids).not.toContain("intruso");
    expect(ids).toHaveLength(8);
  });

  it("la vista previa local también muestra a los nueve con los seis inactivos", async () => {
    const office = (await listAgents({ mode: "local-preview" } as never)).map(toOfficeAgent);
    expect(office).toHaveLength(9);
    expect(office.filter((a) => a.pilot).map((a) => a.id).sort()).toEqual([...ACTIVE_AGENT_IDS].sort());
  });

  it("con RLS, el administrador puede leer las nueve filas de agents (solo lectura)", async () => {
    const t = await createTestDb();
    try {
      const rows = await t.as(ADMIN, async () => (await t.db.query<{ id: string; active: boolean }>(
        `select id, active from public.agents order by id`)).rows);
      expect(rows).toHaveLength(9);
      expect(rows.filter((r) => r.active).map((r) => r.id)).toEqual([...ACTIVE_AGENT_IDS].sort());
    } finally {
      await t.close();
    }
  });
});
