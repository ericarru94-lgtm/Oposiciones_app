// Contrato de validación: fija el JSON Schema que se envía a Claude y qué
// entradas se aceptan o rechazan. Si una actualización de zod cambia algo,
// esta prueba falla. (Generada con zod 4.3.3 y comprobada tras actualizar.)
import { describe, expect, it, vi } from "vitest";
import { parseDeclaredOutcome } from "@/lib/engine/coordination";
import { PILOT_INPUTS, PILOT_SCHEMAS } from "@/lib/engine/pilot-tools";

vi.mock("server-only", () => ({}));
const { readEnv } = await import("@/lib/env");

const U = "11111111-1111-4111-8111-111111111111";
const verdict = (schema: { safeParse: (v: unknown) => { success: boolean; error?: { issues: { path: PropertyKey[]; code: string }[] } } }, v: unknown) => {
  const r = schema.safeParse(v);
  return r.success ? "ok" : r.error!.issues.map((i) => `${i.path.join(".")}:${i.code}`).sort().join(",");
};

describe("contrato zod", () => {
  it("JSON Schema de las herramientas sin cambios", async () => {
    await expect(JSON.stringify(PILOT_SCHEMAS, null, 2)).toMatchFileSnapshot("./__snapshots__/pilot-schemas.json");
  });

  it("aceptación y rechazo de entradas sin cambios", async () => {
    const { CrmWrite, Draft, Delegate, MemoryRead } = PILOT_INPUTS;
    const fact = { key: "telefono", value: "+34 600", source_url: "https://a.example/", source_type: "official_direct", verification_status: "verified" };
    const base = { name: "Gym", city: "Barcelona", website: "https://a.example/", need_detected: "VERIFICADO: no tiene reserva online.", sources: ["https://a.example/"] };
    const cases: Record<string, string> = {
      crm_ok: verdict(CrmWrite, base),
      crm_update: verdict(CrmWrite, { company_id: U, sources: ["https://a.example/"] }),
      crm_ftp: verdict(CrmWrite, { ...base, sources: ["ftp://a.example/"] }),
      crm_phone_long: verdict(CrmWrite, { ...base, phone: "1".repeat(120) }),
      crm_facts_ok: verdict(CrmWrite, { ...base, facts: [fact] }),
      crm_facts_31: verdict(CrmWrite, { ...base, facts: Array.from({ length: 31 }, () => fact) }),
      fact_lower_no_reason: verdict(CrmWrite, { ...base, facts: [{ ...fact, lower_score_to: 10 }] }),
      fact_bad_date: verdict(CrmWrite, { ...base, facts: [{ ...fact, source_date: "2026-13-40" }] }),
      fact_future_date: verdict(CrmWrite, { ...base, facts: [{ ...fact, source_date: "2099-01-01" }] }),
      fact_feb30: verdict(CrmWrite, { ...base, facts: [{ ...fact, source_date: "2026-02-30" }] }),
      fact_ok_date: verdict(CrmWrite, { ...base, facts: [{ ...fact, source_date: "2025-06-01" }] }),
      fact_bad_type: verdict(CrmWrite, { ...base, facts: [{ ...fact, source_type: "rumor" }] }),
      draft_ok: verdict(Draft, { title: "Informe", kind: "report", content: "x".repeat(50) }),
      draft_kind: verdict(Draft, { title: "Informe", kind: "email", content: "x".repeat(50) }),
      delegate_ok: verdict(Delegate, { agent: "marcus", title: "Investigar", instructions: "Instrucciones claras." }),
      delegate_deps6: verdict(Delegate, { agent: "marcus", title: "Investigar", instructions: "Instrucciones claras.", depends_on: Array(6).fill(U) }),
      memory_long: verdict(MemoryRead, { query: "x".repeat(201) }),
    };
    await expect(JSON.stringify(cases, null, 2)).toMatchFileSnapshot("./__snapshots__/zod-verdicts.json");
  });

  it("GHSA-mrhx-c7xc-m3w5: un array por encima de su máximo se rechaza sin validar cada elemento", () => {
    const r = PILOT_INPUTS.CrmWrite.safeParse({ name: "Gym", sources: ["https://a.example/"], facts: Array.from({ length: 5000 }, () => ({ key: 1 })) });
    expect(r.success).toBe(false);
    const factIssues = r.error!.issues.filter((i) => i.path[0] === "facts");
    // zod 4.3.3 generaba 20.000 errores (4 por elemento); desde 4.6.6, uno solo: «too_big».
    expect(factIssues.map((i) => i.code)).toEqual(["too_big"]);
  });

  it("resultado declarado, variables de entorno y rechazo temprano de arrays enormes", () => {
    expect(parseDeclaredOutcome("```resultado\n{\"resultado\":\"completed\",\"objetivos_pendientes\":[\"a\"]}\n```")).toMatchObject({ resultado: "completed", objetivos_pendientes: ["a"] });
    expect(parseDeclaredOutcome(`\`\`\`resultado\n${JSON.stringify({ resultado: "completed", avisos: Array(51).fill("x") })}\n\`\`\``)).toBeNull();
    expect(() => readEnv({ NEXT_PUBLIC_SUPABASE_URL: "no-es-url" })).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(readEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", ADMIN_EMAIL: "" })).toMatchObject({ ADMIN_EMAIL: undefined });
  });
});
