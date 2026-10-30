// Comprobaciones estáticas de la capa de aplicación.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const app = files("src/app");
const src = files("src");

describe("protección de rutas y acciones", () => {
  it("todas las páginas privadas llaman a requireViewer()", () => {
    const pages = app.filter((f) => f.includes("(office)") && /page\.tsx$/.test(f));
    expect(pages.length).toBeGreaterThan(5);
    for (const p of pages) expect({ p, ok: readFileSync(p, "utf8").includes("await requireViewer()") }).toEqual({ p, ok: true });
  });

  it("todas las Server Actions y Route Handlers comprueban al administrador", () => {
    const entry = app.filter((f) => /route\.ts$/.test(f) || readFileSync(f, "utf8").startsWith('"use server"'));
    for (const f of entry) {
      if (f.endsWith("actions/auth.ts")) continue; // login: pública por definición
      const code = readFileSync(f, "utf8");
      const exported = code.match(/export async function \w+/g) ?? [];
      expect({ f, hasExport: exported.length > 0 }).toEqual({ f, hasExport: true });
      const guarded = code.match(/await (requireViewer|requireAdminApi)\(\)/g) ?? [];
      expect({ f, guarded: guarded.length >= exported.length }).toEqual({ f, guarded: true });
    }
  });

  it("la clave secreta y la de Anthropic solo se usan en módulos de servidor", () => {
    for (const f of src) {
      const code = readFileSync(f, "utf8");
      if (/SUPABASE_SECRET_KEY|ANTHROPIC_API_KEY|createSupabaseServiceClient/.test(code)) {
        expect({ f, client: code.startsWith('"use client"') }).toEqual({ f, client: false });
        if (!f.endsWith("env.ts") && !f.includes("supabase/server")) {
          expect({ f, serverOnly: code.includes('import "server-only"') }).toEqual({ f, serverOnly: true });
        }
      }
    }
  });

  it("ninguna variable secreta lleva el prefijo público NEXT_PUBLIC_", () => {
    const example = readFileSync(".env.example", "utf8");
    expect(example).not.toMatch(/NEXT_PUBLIC_[A-Z_]*(SECRET|ANTHROPIC|N8N)/);
  });

  it("envía cabeceras de seguridad", () => {
    const config = readFileSync("next.config.ts", "utf8");
    for (const h of ["X-Frame-Options", "X-Content-Type-Options", "Strict-Transport-Security", "Referrer-Policy"]) {
      expect(config).toContain(h);
    }
  });
});
