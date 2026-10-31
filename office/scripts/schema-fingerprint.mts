// Huella del esquema que dejan las migraciones locales, para compararla con
// producción sin escribir nada allí. Uso:
//   npx tsx scripts/schema-fingerprint.mts [hasta=0008] [pg=17|18]
// En producción se ejecuta supabase/checks/schema-fingerprint-summary.sql
// (solo lectura) y se comparan n y h por categoría.
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { buildSeedSql } from "../src/lib/db/seed";
import { SUPABASE_STUB_SQL } from "../tests/helpers/db";

const upto = process.argv[2] ?? "0008";
const { default: EmbeddedPostgres } = process.argv[3] === "18" ? await import("embedded-postgres") : await import("embedded-postgres-17");
const md5 = (s: string) => createHash("md5").update(s).digest("hex");
const base = mkdtempSync(join(tmpdir(), "fp-")); chmodSync(base, 0o777);
const port = 58000 + Math.floor(Math.random() * 500);
const db = new EmbeddedPostgres({ databaseDir: join(base, "d"), user: "postgres", password: "x", port, persistent: false, onLog: () => {} });
await db.initialise(); await db.start();
const c = new pg.Client({ host: "localhost", port, user: "postgres", password: "x", database: "postgres" }); await c.connect();
try {
  await c.query(SUPABASE_STUB_SQL());
  for (const f of readdirSync("supabase/migrations").sort().filter((f) => f < upto)) await c.query(readFileSync(`supabase/migrations/${f}`, "utf8"));
  await c.query(buildSeedSql());
  const { rows } = await c.query<{ k: string; v: string }>(readFileSync("supabase/checks/schema-fingerprint.sql", "utf8"));
  const byK = new Map<string, string[]>();
  for (const r of rows) byK.set(r.k, [...(byK.get(r.k) ?? []), `${r.k}|${md5(r.v).slice(0, 10)}`]);
  console.log(`migraciones < ${upto} · ${(await c.query("select version()")).rows[0].version.split(" on ")[0]}`);
  for (const [k, list] of [...byK].sort()) {
    const sorted = list.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    console.log(`${k}\t${list.length}\t${md5(sorted.join(" ")).slice(0, 12)}`);
  }
} finally { await c.end(); await db.stop(); rmSync(base, { recursive: true, force: true }); }
