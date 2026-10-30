import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { authMode, integrationStatus, readEnv, defaultModel } = await import("@/lib/env");

const supabase = {
  NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
  ADMIN_EMAIL: "admin@hesignalagency.com",
};

describe("entorno", () => {
  it("exige sesión cuando Supabase está configurado", () => {
    expect(authMode(readEnv(supabase), "production")).toBe("supabase");
  });

  it("la vista previa local nunca se activa en producción", () => {
    expect(authMode(readEnv({ LOCAL_PREVIEW: "1" }), "production")).toBe("not-configured");
    expect(authMode(readEnv({ LOCAL_PREVIEW: "1" }), "development")).toBe("local-preview");
    expect(authMode(readEnv({}), "development")).toBe("not-configured");
  });

  it("no expone valores de las claves, solo si están configuradas", () => {
    const status = integrationStatus(readEnv({ ...supabase, ANTHROPIC_API_KEY: "sk-ant-secreto" }));
    expect(JSON.stringify(status)).not.toContain("sk-ant-secreto");
    expect(status.find((s) => s.id === "anthropic")?.configured).toBe(true);
    expect(status.find((s) => s.id === "n8n")?.configured).toBe(false);
  });

  it("valida el email del administrador y el modelo por defecto", () => {
    expect(() => readEnv({ ADMIN_EMAIL: "no-es-email" })).toThrow();
    expect(defaultModel(readEnv({ DEFAULT_AGENT_MODEL: "modelo-raro" }))).toBe("claude-opus-5-5");
    expect(defaultModel(readEnv({ DEFAULT_AGENT_MODEL: "claude-sonnet-5-5" }))).toBe("claude-sonnet-5-5");
  });
});
