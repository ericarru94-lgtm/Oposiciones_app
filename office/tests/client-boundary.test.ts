// El registro de agentes incluye sus instrucciones internas: no debe llegar al
// navegador. Ningún módulo de cliente (ni lo que importan) puede importarlo;
// lo público está en agents/catalog.ts.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { expect, it } from "vitest";

const SRC = resolve("src");
const files: string[] = [];
(function walk(d: string) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(p)) files.push(p);
  }
})(SRC);

function importsOf(file: string): string[] {
  const code = readFileSync(file, "utf8");
  return [...code.matchAll(/^import\s+(?!type\b)[^;]*?from\s+"([^"]+)"/gm)].map((m) => m[1]);
}
function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? join(SRC, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : null;
  if (!base) return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) if (files.includes(c)) return c;
  return null;
}

it("ningún módulo de cliente arrastra el registro de agentes (con sus instrucciones) al navegador", () => {
  const clients = files.filter((f) => /^\s*["']use client["']/.test(readFileSync(f, "utf8")));
  expect(clients.length).toBeGreaterThan(5);
  const offenders: string[] = [];
  for (const entry of clients) {
    const seen = new Set<string>();
    const stack = [entry];
    while (stack.length) {
      const f = stack.pop()!;
      if (seen.has(f)) continue;
      seen.add(f);
      // Las acciones de servidor se ejecutan en el servidor: el cliente solo recibe una referencia.
      if (f !== entry && /^\s*["']use server["']/.test(readFileSync(f, "utf8"))) continue;
      if (f.endsWith(join("agents", "registry.ts"))) offenders.push(`${entry.replace(SRC, "src")} → registry.ts`);
      for (const spec of importsOf(f)) {
        const r = resolveImport(f, spec);
        if (r) stack.push(r);
      }
    }
  }
  expect(offenders).toEqual([]);
});
