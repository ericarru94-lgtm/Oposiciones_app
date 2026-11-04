// Barrera de entorno: una vista previa de Vercel nunca usa el Supabase de producción.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { authMode, readEnv } from "@/lib/env";
import { PRODUCTION_SUPABASE_REF, isProductionSupabaseUrl, previewUsesProductionSupabase } from "@/lib/env-guard";

const PROD = `https://${PRODUCTION_SUPABASE_REF}.supabase.co`;
const STAGING = "https://jbtrkfzvjiywlsxdsecq.supabase.co";
const base = { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x", ADMIN_EMAIL: "admin@test.dev", SUPABASE_SECRET_KEY: "sb_secret_x" };

describe("barrera Preview → Supabase de producción", () => {
  it("reconoce la URL de producción (y no otras)", () => {
    expect(isProductionSupabaseUrl(PROD)).toBe(true);
    expect(isProductionSupabaseUrl(`${PROD}/`)).toBe(true);
    expect(isProductionSupabaseUrl(STAGING)).toBe(false);
    expect(isProductionSupabaseUrl(`https://evil.com/${PRODUCTION_SUPABASE_REF}`)).toBe(false);
    expect(isProductionSupabaseUrl(undefined)).toBe(false);
    expect(isProductionSupabaseUrl("no es una url")).toBe(false);
  });

  it("vista previa + producción → sin configurar (sin URL, claves ni administrador)", () => {
    const env = { ...base, VERCEL_ENV: "preview", NEXT_PUBLIC_SUPABASE_URL: PROD };
    expect(previewUsesProductionSupabase(env)).toBe(true);
    const parsed = readEnv(env);
    expect(parsed).toMatchObject({ NEXT_PUBLIC_SUPABASE_URL: undefined, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined, SUPABASE_SECRET_KEY: undefined, ADMIN_EMAIL: undefined });
    expect(authMode(parsed, "production")).toBe("not-configured");
  });

  it("vista previa + entorno de pruebas → funciona con normalidad", () => {
    const env = { ...base, VERCEL_ENV: "preview", NEXT_PUBLIC_SUPABASE_URL: STAGING };
    expect(previewUsesProductionSupabase(env)).toBe(false);
    expect(authMode(readEnv(env), "production")).toBe("supabase");
  });

  it("producción y entorno local no cambian", () => {
    for (const VERCEL_ENV of ["production", undefined, "development"]) {
      const env = { ...base, VERCEL_ENV, NEXT_PUBLIC_SUPABASE_URL: PROD };
      expect(previewUsesProductionSupabase(env)).toBe(false);
      expect(readEnv(env).NEXT_PUBLIC_SUPABASE_URL).toBe(PROD);
      expect(authMode(readEnv(env), "production")).toBe("supabase");
    }
  });
});
