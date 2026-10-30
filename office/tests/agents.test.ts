import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AGENTS, DEPARTMENTS, MODELS } from "@/lib/agents/registry";
import { TOOLS, isToolId } from "@/lib/agents/tools";
import { evaluateToolUse, riskRequiresApproval } from "@/lib/agents/permissions";
import { composeSystemPrompt } from "@/lib/agents/prompts";
import { buildSeedSql } from "@/lib/db/seed";

describe("registro de agentes", () => {
  it("tiene los nueve empleados del encargo", () => {
    expect(AGENTS.map((a) => a.name)).toEqual([
      "Alex", "Marcus", "Sofia", "Daniel", "Lucia", "David", "Emma", "Oscar", "Victoria",
    ]);
  });

  it("ids, escritorios y departamentos son válidos y únicos", () => {
    expect(new Set(AGENTS.map((a) => a.id)).size).toBe(AGENTS.length);
    expect(new Set(AGENTS.map((a) => `${a.desk.x},${a.desk.z}`)).size).toBe(AGENTS.length);
    for (const a of AGENTS) {
      expect(DEPARTMENTS[a.department]).toBeDefined();
      expect(MODELS[a.model]).toBeDefined();
      for (const t of a.tools) expect(isToolId(t)).toBe(true);
      expect(new Set(a.tools).size).toBe(a.tools.length);
    }
  });

  it("solo Alex coordina y delega", () => {
    expect(AGENTS.filter((a) => a.isCoordinator).map((a) => a.id)).toEqual(["alex"]);
    expect(AGENTS.filter((a) => a.tools.includes("tasks.delegate")).map((a) => a.id)).toEqual(["alex"]);
  });

  it("Victoria y Alex pueden revisar calidad", () => {
    const reviewers = AGENTS.filter((a) => a.tools.includes("quality.review")).map((a) => a.id);
    expect(reviewers).toContain("victoria");
  });

  it("todas las instrucciones llevan las reglas comunes de honestidad y aprobación", () => {
    for (const a of AGENTS) {
      const p = composeSystemPrompt(a.instructions);
      expect(p).toContain("Nunca inventes");
      expect(p).toContain("No simules acciones");
      expect(p).toContain("aprobación del administrador");
      expect(p).toContain(`Eres ${a.name}`);
    }
  });

  it("el seed.sql del repositorio está al día con el registro", () => {
    expect(readFileSync("supabase/seed.sql", "utf8")).toBe(buildSeedSql());
  });

});

describe("permisos", () => {
  const marcus = AGENTS.find((a) => a.id === "marcus")!;

  it("las acciones externas, gasto, producción y borrado requieren aprobación", () => {
    for (const t of Object.values(TOOLS)) {
      const expected = ["external_action", "spend", "production_change", "destructive"].includes(t.risk);
      expect(riskRequiresApproval(t.risk)).toBe(expected);
    }
    expect(TOOLS["email.send"].risk).toBe("external_action");
    expect(TOOLS["social.publish"].risk).toBe("external_action");
    expect(TOOLS["ads.launch"].risk).toBe("spend");
    expect(TOOLS["n8n.production"].risk).toBe("production_change");
    expect(TOOLS["data.delete"].risk).toBe("destructive");
  });

  it("niega herramientas que el agente no tiene", () => {
    expect(evaluateToolUse(marcus, "tasks.delegate").decision).toBe("denied");
    expect(evaluateToolUse(marcus, "no.existe").decision).toBe("denied");
  });

  it("no simula herramientas sin conectar", () => {
    expect(evaluateToolUse(marcus, "email.send").decision).toBe("unavailable");
  });

  it("pide aprobación cuando una herramienta arriesgada está conectada", () => {
    const connected = new Set(["email.send", "crm.read"]);
    expect(evaluateToolUse(marcus, "email.send", connected).decision).toBe("needs_approval");
    expect(evaluateToolUse(marcus, "crm.read", connected).decision).toBe("allow");
    expect(evaluateToolUse(marcus, "web.search", connected).decision).toBe("unavailable");
  });
});
