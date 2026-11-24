// PI-16 · Utilidad común del laboratorio: PostgreSQL 17 embebido, solo 127.0.0.1,
// directorio temporal, datos ficticios. Nunca usa variables de entorno ni red externa.
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import EmbeddedPostgres from "embedded-postgres-17";
import { SUPABASE_STUB_SQL } from "../../tests/helpers/db";
import { buildSeedSql } from "../../src/lib/db/seed";

export type Lab = {
  port: number;
  admin: pg.Client;
  connect: () => Promise<pg.Client>;
  applyMigrations: (filter?: (f: string) => boolean, c?: pg.Client) => Promise<string[]>;
  seed: (c?: pg.Client) => Promise<void>;
  isolation: () => Promise<{ version: string; listen: string; ok: boolean }>;
  createDb: (name: string) => Promise<pg.Client>;
  stop: () => Promise<void>;
};

export async function startLab(prefix: string, extraFlags: string[] = []): Promise<Lab> {
  const base = mkdtempSync(join(tmpdir(), prefix));
  chmodSync(base, 0o777);
  const port = 58000 + Math.floor(Math.random() * 900);
  const server = new EmbeddedPostgres({
    databaseDir: join(base, "d"), user: "postgres", password: "x", port, persistent: false, onLog: () => {},
    postgresFlags: ["-c", "listen_addresses=127.0.0.1", "-c", "deadlock_timeout=200ms", "-c", "max_connections=120", ...extraFlags],
  });
  const clients: pg.Client[] = [];
  const connectTo = async (database: string) => {
    const c = new pg.Client({ host: "127.0.0.1", port, user: "postgres", password: "x", database });
    c.on("error", () => {});
    await c.connect();
    clients.push(c);
    return c;
  };
  await server.initialise();
  await server.start();
  const admin = await connectTo("postgres");
  const migrations = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
  return {
    port,
    admin,
    connect: () => connectTo("postgres"),
    applyMigrations: async (filter = () => true, c = admin) => {
      // Los roles son del clúster: en la segunda base ya existen.
      await c.query(SUPABASE_STUB_SQL().replace(/create role (\w+) nologin( bypassrls)?;/g,
        "do $$$$ begin create role $1 nologin$2; exception when duplicate_object then null; end $$$$;"));
      const applied: string[] = [];
      for (const f of migrations.filter(filter)) {
        await c.query(readFileSync(`supabase/migrations/${f}`, "utf8"));
        applied.push(f);
      }
      return applied;
    },
    seed: async (c = admin) => { await c.query(buildSeedSql()); },
    isolation: async () => {
      const version = (await admin.query("show server_version")).rows[0].server_version as string;
      const listen = (await admin.query("show listen_addresses")).rows[0].listen_addresses as string;
      return { version, listen, ok: /^17\./.test(version) && listen === "127.0.0.1" };
    },
    createDb: async (name: string) => {
      await admin.query(`create database ${name}`);
      return connectTo(name);
    },
    stop: async () => {
      for (const c of clients) await c.end().catch(() => {});
      await server.stop().catch(() => {});
      rmSync(base, { recursive: true, force: true });
    },
  };
}
