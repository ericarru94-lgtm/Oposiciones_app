// Migración 0011 (fase 5.1.2): activity_log con acciones cerradas para el
// navegador e historial de solo añadir. Se prueba sobre el estado tras 0010
// (0001–0010 + seed) en PostgreSQL 17.11 (la versión de producción) y 18,
// recorriendo TODOS los caminos de escritura legítimos.
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres18 from "embedded-postgres";
import EmbeddedPostgres17 from "embedded-postgres-17";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { buildSeedSql } from "@/lib/db/seed";
import { ADMIN, SUPABASE_STUB_SQL } from "./helpers/db";

const FINGERPRINT = readFileSync("supabase/checks/schema-fingerprint.sql", "utf8");
const MIGRATION = readFileSync("supabase/migrations/0011_activity_log_hardening.sql", "utf8");
const ROLLBACK = readFileSync("supabase/checks/0011_rollback.sql", "utf8");
const UI_ACTIONS = ["auth.login", "mission.created", "mission.cancelled", "settings.limits_updated"];
const LOG = `select actor_type, actor_id, action from public.activity_log order by id`;

describe.each([
  ["PostgreSQL 17.11 (producción)", EmbeddedPostgres17],
  ["PostgreSQL 18", EmbeddedPostgres18],
])("0011 en %s", (_label, EmbeddedPostgres) => {
  it("acciones cerradas para el navegador, historial de solo añadir y caminos legítimos intactos", async () => {
    const base = mkdtempSync(join(tmpdir(), "mig11-")); chmodSync(base, 0o777);
    const port = 58000 + Math.floor(Math.random() * 900);
    const pg = new EmbeddedPostgres({ databaseDir: join(base, "d"), user: "postgres", password: "x", port, persistent: false, onLog: () => {} });
    await pg.initialise(); await pg.start();
    const conn = async () => { const c = new Client({ host: "localhost", port, user: "postgres", password: "x", database: "postgres" }); await c.connect(); return c; };
    const root = await conn();
    const clients: Client[] = [root];
    const svc = async () => {
      const c = await conn(); clients.push(c);
      await c.query(`set role service_role; select set_config('request.jwt.claims', '{"role":"service_role"}', false)`);
      return c;
    };
    const asUser = async (role: "authenticated" | "anon", uid = ADMIN) => {
      const c = await conn(); clients.push(c);
      await c.query(`set role ${role}; select set_config('request.jwt.claim.sub', '${role === "anon" ? "" : uid}', false),
        set_config('request.jwt.claims', '{"role":"${role}"${role === "anon" ? "" : `,"sub":"${uid}"`}}', false), set_config('request.jwt.claim.role', '${role}', false)`);
      return c;
    };
    const code = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return (e as { code?: string }).code ?? String(e); } };
    const checksum = async (table: string) =>
      (await root.query(`select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) m from public."${table}" t`)).rows[0].m as string;
    const fingerprint = async () => new Set((await root.query<{ k: string; v: string }>(FINGERPRINT)).rows.map((r) => `${r.k}|${r.v}`));
    const log = async () => (await root.query(LOG)).rows;
    try {
      // ── Estado tras 0010.
      await root.query(SUPABASE_STUB_SQL());
      for (const f of readdirSync("supabase/migrations").sort().filter((f) => f < "0011")) await root.query(readFileSync(`supabase/migrations/${f}`, "utf8"));
      await root.query(buildSeedSql());
      await root.query(`insert into auth.users (id, email) values ('${ADMIN}', 'admin@hesignal.test');
                        insert into public.admins (user_id, email) values ('${ADMIN}', 'admin@hesignal.test');
                        insert into public.activity_log (actor_type, actor_id, action) values ('admin', '${ADMIN}', 'auth.login');`);
      const tables: Record<string, string> = {};
      for (const { relname } of (await root.query<{ relname: string }>(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'`)).rows) tables[relname] = await checksum(relname);
      const fpBefore = await fingerprint();
      // Antes de 0011 el administrador SÍ podía imitar un evento del trigger de 0010 (el riesgo).
      const pre = await asUser("authenticated");
      await pre.query("begin");
      expect(await code(pre.query(`insert into public.activity_log (actor_type, actor_id, action, entity_id) values ('admin', '${ADMIN}', 'agent.config_changed', 'daniel')`))).toBe("ok");
      await pre.query("rollback");

      // ── Transaccional.
      await root.query("begin"); await expect(root.query(MIGRATION + "\nselect 1/0;")).rejects.toThrow(); await root.query("rollback");
      expect(await fingerprint()).toEqual(fpBefore);
      await root.query("begin"); await root.query(MIGRATION); await root.query("commit");
      for (const [t, h] of Object.entries(tables)) expect({ t, h: await checksum(t) }).toEqual({ t, h });

      // Esquema: solo lo previsto (política nueva, función INVOKER, triggers y permisos de service_role).
      const fpAfter = await fingerprint();
      const gone = [...fpBefore].filter((x) => !fpAfter.has(x)).sort();
      const added = [...fpAfter].filter((x) => !fpBefore.has(x)).sort();
      expect(gone).toEqual(["grant|activity_log:service_role:DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE"]);
      expect(added.filter((x) => !x.startsWith("fn|activity_log_append_only():false:"))).toEqual([
        "fexec|activity_log_append_only():anon:false",
        "fexec|activity_log_append_only():authenticated:false",
        "fexec|activity_log_append_only():service_role:false",
        "grant|activity_log:service_role:INSERT,REFERENCES,SELECT,TRIGGER",
        "pol|activity_log:actividad: acciones de la interfaz:INSERT:authenticated::(action = ANY (ARRAY['auth.login'::text, 'mission.created'::text, 'mission.cancelled'::text, 'settings.limits_updated'::text]))",
        "trg|activity_log:activity_log_append_only:DELETE:BEFORE",
        "trg|activity_log:activity_log_append_only:UPDATE:BEFORE",
      ]);
      expect(added.filter((x) => x.startsWith("fn|"))).toHaveLength(1);
      expect((await root.query(`select count(*)::int n from pg_trigger where tgname = 'activity_log_no_truncate'`)).rows[0].n).toBe(1);
      const before = await log();

      // ── 1. Las cuatro acciones de la interfaz siguen funcionando.
      const admin = await asUser("authenticated");
      for (const action of UI_ACTIONS) {
        expect({ action, r: await code(admin.query(`insert into public.activity_log (actor_type, actor_id, action) values ('admin', $1, $2)`, [ADMIN, action])) }).toEqual({ action, r: "ok" });
      }
      // Las reglas anteriores se mantienen: solo como admin y con el propio id.
      expect(await code(admin.query(`insert into public.activity_log (actor_type, actor_id, action) values ('admin', '22222222-2222-2222-2222-222222222222', 'auth.login')`))).toBe("42501");
      expect(await code(admin.query(`insert into public.activity_log (actor_type, action) values ('system', 'auth.login')`))).toBe("42501");

      // ── 2 y 3. agent.* y approval.* no se pueden insertar desde el navegador (ni nada fuera de la lista).
      for (const action of ["agent.config_changed", "agent.created", "approval.approved", "approval.rejected", "approval.consumed", "approval.use_denied", "login", "settings.changed", "AUTH.LOGIN"]) {
        expect({ action, r: await code(admin.query(`insert into public.activity_log (actor_type, actor_id, action) values ('admin', $1, $2)`, [ADMIN, action])) }).toEqual({ action, r: "42501" });
      }
      const anon = await asUser("anon");
      expect(await code(anon.query(`insert into public.activity_log (actor_type, action) values ('admin', 'auth.login')`))).toBe("42501");

      // ── 4. Las funciones legítimas de aprobación siguen escribiendo, cada una en su contexto.
      const s = await svc();
      const approval = async (taskTitle: string) => {
        await root.query(`insert into public.tasks (title, agent_id, status) values ($1, 'marcus', 'assigned')`, [taskTitle]);
        const { rows: [c] } = await s.query(`select * from public.claim_next_task('w1', 240, 5)`);
        const { rows: [{ id }] } = await s.query(`select public.request_approval($1, 'w1', 'toolu_1', 'email.send', 'external_action', 'send', $2, 'Enviar') as id`, [c.run_id, '{"to":"a@b.c"}']);
        await s.query(`select public.pause_for_approval($1, 'w1', '{}')`, [c.run_id]);
        return { id, run: c.run_id as string };
      };
      const a1 = await approval("Con aprobación");
      await admin.query(`select public.decide_approval($1, true, 'OK')`, [a1.id]);                      // SECURITY DEFINER, como administrador
      expect((await s.query(`select public.consume_approval($1, $2, 'email.send', 'send', '{"to":"x@y.z"}') ok`, [a1.id, a1.run])).rows[0].ok).toBe(false); // otros argumentos
      expect((await s.query(`select public.consume_approval($1, $2, 'email.send', 'send', '{"to":"a@b.c"}') ok`, [a1.id, a1.run])).rows[0].ok).toBe(true);
      await root.query(`update public.tasks set status = 'completed', locked_by = null, locked_until = null where status <> 'completed'`);
      await root.query(`update public.agent_runs set status = 'succeeded' where status not in ('succeeded', 'failed')`);
      const a2 = await approval("Rechazada");
      await admin.query(`select public.decide_approval($1, false, 'No')`, [a2.id]);
      const tail = (await log()).slice(before.length + UI_ACTIONS.length);
      expect(tail.map((r) => [r.actor_type, r.actor_id, r.action])).toEqual([
        ["admin", ADMIN, "approval.approved"],
        ["system", "engine", "approval.use_denied"],
        ["system", "engine", "approval.consumed"],
        ["admin", ADMIN, "approval.rejected"],
      ]);

      // ── 5. El trigger de 0010 sigue registrando cambios de agentes.
      await s.query(`update public.agents set effort = 'high' where id = 'alex'`);
      await root.query(`update public.agents set effort = 'medium' where id = 'alex'`);
      const agentRows = (await log()).filter((r) => r.action === "agent.config_changed");
      expect(agentRows).toHaveLength(2);
      expect(agentRows.every((r) => r.actor_type === "system")).toBe(true);

      // ── 6. Nadie puede modificar, borrar ni vaciar el historial: ni la API ni el dueño de la tabla.
      const snapshot = await checksum("activity_log");
      const count = (await log()).length;
      for (const [who, c] of [["authenticated", admin], ["anon", anon], ["service_role", s], ["postgres", root]] as const) {
        for (const sql of [`update public.activity_log set action = 'x'`, `delete from public.activity_log`, `truncate public.activity_log`]) {
          expect({ who, sql, r: await code(c.query(sql)) }).toEqual({ who, sql, r: "42501" });
        }
      }
      // ── 7. Los registros históricos se conservan intactos.
      expect(await checksum("activity_log")).toBe(snapshot);
      expect((await log()).length).toBe(count);
      expect((await log()).slice(0, before.length)).toEqual(before);

      // ── 8. Marcha atrás: vuelve todo como tras 0010, sin perder filas; y se puede volver a aplicar.
      await root.query(ROLLBACK);
      expect(await fingerprint()).toEqual(fpBefore);
      expect(await checksum("activity_log")).toBe(snapshot);
      expect(await code(admin.query(`insert into public.activity_log (actor_type, actor_id, action) values ('admin', $1, 'agent.config_changed')`, [ADMIN]))).toBe("ok");
      await s.query("begin"); expect(await code(s.query(`delete from public.activity_log where action = 'agent.config_changed' and actor_type = 'admin'`))).toBe("ok"); await s.query("rollback");
      await root.query("begin"); await root.query(MIGRATION); await root.query("commit");
      expect(new Set(await fingerprint())).toEqual(new Set(fpAfter));
    } finally {
      for (const c of clients) await c.end().catch(() => {});
      await pg.stop();
      rmSync(base, { recursive: true, force: true });
    }
  }, 240_000);
});
