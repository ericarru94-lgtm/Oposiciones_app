// Migración 0010 (fase 5.1.1): sin UPDATE directo de model/effort/active desde
// el navegador, solo los agentes aprobados pueden estar activos y cada cambio
// real queda auditado en activity_log. Se prueba sobre el estado de producción
// tras 0009 (0001–0009 + seed: Alex, Marcus y Sofia activos) en PostgreSQL
// 17.11 (la versión de producción) y 18.
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres18 from "embedded-postgres";
import EmbeddedPostgres17 from "embedded-postgres-17";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { ACTIVE_AGENT_IDS } from "@/lib/agents/catalog";
import { AGENT_IDS } from "@/lib/agents/registry";
import { buildSeedSql } from "@/lib/db/seed";
import { ADMIN, SUPABASE_STUB_SQL } from "./helpers/db";

const FINGERPRINT = readFileSync("supabase/checks/schema-fingerprint.sql", "utf8");
const MIGRATION = readFileSync("supabase/migrations/0010_agent_config_hardening.sql", "utf8");
const ROLLBACK = readFileSync("supabase/checks/0010_rollback.sql", "utf8");
const INACTIVE = ["daniel", "lucia", "david", "emma", "oscar", "victoria"];
const TABLES = `select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1`;
// La huella del esquema no incluye permisos por columna: se comparan aparte.
const COLUMN_GRANTS = `select table_name || '.' || column_name || ':' || grantee || ':' || privilege_type v
  from information_schema.column_privileges where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role') order by 1`;
const NEW_AGENT = `(id, name, role, department, specialty, description, personality, instructions, model, active)
  values ('nuevo', 'N', 'R', 'D', 'S', 'Desc', 'P', 'I', 'claude-haiku-5-5',`;
const AUDIT = `select actor_type, actor_id, action, entity_type, entity_id, details from public.activity_log
  where action in ('agent.config_changed', 'agent.created') order by id`;

describe.each([
  ["PostgreSQL 17.11 (producción)", EmbeddedPostgres17],
  ["PostgreSQL 18", EmbeddedPostgres18],
])("0010 en %s", (_label, EmbeddedPostgres) => {
  it("permisos, lista aprobada y auditoría de agentes, con marcha atrás", async () => {
    const base = mkdtempSync(join(tmpdir(), "mig10-")); chmodSync(base, 0o777);
    const port = 58000 + Math.floor(Math.random() * 900);
    const pg = new EmbeddedPostgres({ databaseDir: join(base, "d"), user: "postgres", password: "x", port, persistent: false, onLog: () => {} });
    await pg.initialise(); await pg.start();
    const conn = async () => { const c = new Client({ host: "localhost", port, user: "postgres", password: "x", database: "postgres" }); await c.connect(); return c; };
    const root = await conn();
    const clients: Client[] = [root];
    // service_role tal y como llega desde la API (supabase-js con la clave secreta).
    const svc = async () => {
      const c = await conn(); clients.push(c);
      await c.query(`set role service_role; select set_config('request.jwt.claims', '{"role":"service_role"}', false)`);
      return c;
    };
    // Administrador real con sesión (rol authenticated y su JWT).
    const asAdmin = async () => {
      const c = await conn(); clients.push(c);
      await c.query(`set role authenticated; select set_config('request.jwt.claim.sub', '${ADMIN}', false),
        set_config('request.jwt.claims', '{"role":"authenticated","sub":"${ADMIN}"}', false), set_config('request.jwt.claim.role', 'authenticated', false)`);
      return c;
    };
    const code = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return (e as { code?: string }).code ?? String(e); } };
    const checksum = async (table: string) =>
      (await root.query(`select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) m from public."${table}" t`)).rows[0].m as string;
    const fingerprint = async () => new Set((await root.query<{ k: string; v: string }>(FINGERPRINT)).rows.map((r) => `${r.k}|${r.v}`));
    const colGrants = async () => (await root.query<{ v: string }>(COLUMN_GRANTS)).rows.map((r) => r.v);
    const audit = async () => (await root.query(AUDIT)).rows;
    const activeIds = async () => (await root.query(`select id from public.agents where active order by id`)).rows.map((r) => r.id);
    try {
      // ── Estado de producción tras 0009.
      await root.query(SUPABASE_STUB_SQL());
      for (const f of readdirSync("supabase/migrations").sort().filter((f) => f < "0010")) await root.query(readFileSync(`supabase/migrations/${f}`, "utf8"));
      await root.query(buildSeedSql());
      await root.query(`insert into auth.users (id, email) values ('${ADMIN}', 'admin@hesignal.test');
                        insert into public.admins (user_id, email) values ('${ADMIN}', 'admin@hesignal.test');`);
      await root.query(`insert into public.tasks (title, agent_id, status, input) values ('Misión previa', 'alex', 'completed', '{"kind":"mission"}')`);
      await root.query(`insert into public.activity_log (actor_type, action) values ('system', 'previo')`);
      expect(await activeIds()).toEqual([...ACTIVE_AGENT_IDS].sort());

      const tablesBefore: Record<string, string> = {};
      for (const { relname } of (await root.query<{ relname: string }>(TABLES)).rows) tablesBefore[relname] = await checksum(relname);
      const fpBefore = await fingerprint();
      const grantsBefore = await colGrants();
      // Antes de 0010 el administrador SÍ podía activar a un agente desde el navegador (el riesgo).
      const pre = await asAdmin();
      await pre.query("begin");
      expect(await code(pre.query(`update public.agents set active = true where id = 'daniel'`))).toBe("ok");
      await pre.query("rollback");

      // ── 13a. Transaccional: un fallo a mitad no deja nada aplicado.
      await root.query("begin"); await expect(root.query(MIGRATION + "\nselect 1/0;")).rejects.toThrow(); await root.query("rollback");
      expect(await fingerprint()).toEqual(fpBefore);
      expect(await colGrants()).toEqual(grantsBefore);

      // ── Aplicación real en una transacción.
      await root.query("begin"); await root.query(MIGRATION); await root.query("commit");

      // No cambia ningún dato (ni agentes ni activity_log ni nada más).
      for (const [t, h] of Object.entries(tablesBefore)) expect({ t, h: await checksum(t) }).toEqual({ t, h });

      // ── 12. Esquema y permisos: solo lo previsto.
      const fpAfter = await fingerprint();
      const gone = [...fpBefore].filter((x) => !fpAfter.has(x));
      const added = [...fpAfter].filter((x) => !fpBefore.has(x)).sort();
      expect(gone).toEqual([]);
      expect(added.filter((x) => !x.startsWith("fn|log_agent_config_change():false:"))).toEqual([
        "con|agents:agents_active_aprobados:CHECK (((NOT active) OR (id = ANY (ARRAY['alex'::text, 'marcus'::text, 'sofia'::text]))))",
        "fexec|log_agent_config_change():anon:false",
        "fexec|log_agent_config_change():authenticated:false",
        "fexec|log_agent_config_change():service_role:true",
        "trg|agents:agents_config_audit:UPDATE:AFTER",
        "trg|agents:agents_config_audit_insert:INSERT:AFTER",
      ]);
      expect(added.filter((x) => x.startsWith("fn|"))).toHaveLength(1); // la función nueva, SECURITY INVOKER (:false:)
      const grantsAfter = await colGrants();
      expect(grantsBefore.filter((g) => !grantsAfter.includes(g)).sort()).toEqual([
        "agents.active:authenticated:UPDATE", "agents.effort:authenticated:UPDATE", "agents.model:authenticated:UPDATE",
      ]);
      expect(grantsAfter.filter((g) => !grantsBefore.includes(g))).toEqual([]);
      expect(grantsAfter.filter((g) => g.startsWith("agents.") && g.endsWith(":UPDATE") && !g.includes(":service_role:"))).toEqual([]);

      // Una sola fuente de verdad: la lista de la restricción es ACTIVE_AGENT_IDS.
      const { rows: [con] } = await root.query(`select pg_get_constraintdef(oid) d from pg_constraint where conname = 'agents_active_aprobados'`);
      expect([...con.d.matchAll(/'([a-z]+)'::text/g)].map((m) => m[1]).sort()).toEqual([...ACTIVE_AGENT_IDS].sort());

      // ── 1. authenticated (incluso el administrador) no puede cambiar active, model ni effort.
      const admin = await asAdmin();
      for (const sql of [
        `update public.agents set active = true where id = 'daniel'`,
        `update public.agents set active = false where id = 'alex'`,
        `update public.agents set model = 'claude-opus-5-5' where id = 'alex'`,
        `update public.agents set effort = 'low' where id = 'marcus'`,
        `update public.agents set model = 'claude-opus-5-5', effort = 'high', active = true where id = 'emma'`,
      ]) expect({ sql, r: await code(admin.query(sql)) }).toEqual({ sql, r: "42501" });
      expect(await code(admin.query(`insert into public.agents ${NEW_AGENT} false)`))).toBe("42501");
      // Sigue pudiendo leerlos.
      expect((await admin.query(`select count(*)::int n from public.agents`)).rows[0].n).toBe(AGENT_IDS.length);

      // ── 2 y 4. service_role sí puede hacer cambios autorizados, y cada cambio real queda registrado.
      const s = await svc();
      await s.query(`update public.agents set model = 'claude-haiku-5-5' where id = 'alex'`);
      let log = await audit();
      expect(log).toHaveLength(1);
      expect(log[0]).toEqual({
        actor_type: "system", actor_id: null, action: "agent.config_changed", entity_type: "agent", entity_id: "alex",
        details: {
          cambios: { model: { antes: "claude-sonnet-5-5", despues: "claude-haiku-5-5" } },
          actor: "desconocido", origen: "api (service_role: servidor de la oficina)", rol_bd: "service_role", rol_jwt: "service_role",
          registrado_por: "trigger agents_config_audit (0010)",
        },
      });
      // ── 5. Varios campos en una operación → un único registro coherente.
      await s.query(`update public.agents set model = 'claude-sonnet-5-5', effort = 'high' where id = 'alex'`);
      log = await audit();
      expect(log).toHaveLength(2);
      expect(log[1].details.cambios).toEqual({
        model: { antes: "claude-haiku-5-5", despues: "claude-sonnet-5-5" }, effort: { antes: "medium", despues: "high" },
      });
      await s.query(`update public.agents set effort = 'medium' where id = 'alex'`); // vuelve a su valor
      // Desactivar a un agente aprobado está permitido y se registra (SQL directo: migración, seed, editor).
      await root.query(`update public.agents set active = false where id = 'sofia'`);
      log = await audit();
      expect(log).toHaveLength(4);
      expect(log[3]).toMatchObject({ actor_type: "system", actor_id: null, entity_id: "sofia",
        details: { cambios: { active: { antes: true, despues: false } }, origen: "sql directo (migración, seed o editor SQL)", rol_bd: "postgres", rol_jwt: null } });
      await root.query(`update public.agents set active = true where id = 'sofia'`);
      expect(await audit()).toHaveLength(5);

      // ── 6. Actualizaciones sin cambios reales → ningún registro.
      await s.query(`update public.agents set model = model, effort = effort, active = active`);
      await s.query(`update public.agents set name = name, status = 'available' where id = 'marcus'`); // otras columnas: no se auditan
      await s.query(`select public.set_agent_state('alex', 'working', null, 'prueba')`);
      await s.query(`select public.set_agent_state('alex', 'available', null, null)`);
      expect(await audit()).toHaveLength(5);

      // ── 3. El seed sigue funcionando (dos veces) y no genera registros si no cambia nada.
      const agentsBeforeSeed = (await root.query(`select * from public.agents order by id`)).rows.map(({ updated_at: _u, status_updated_at: _s, status_detail: _d, ...r }) => r);
      await root.query(buildSeedSql());
      const ss = await svc(); await ss.query(buildSeedSql());
      expect(await audit()).toHaveLength(5);
      expect((await root.query(`select * from public.agents order by id`)).rows.map(({ updated_at: _u, status_updated_at: _s, status_detail: _d, ...r }) => r)).toEqual(agentsBeforeSeed);

      // ── 7. Nadie puede activar a los seis: ni service_role ni postgres, ni de uno en uno ni todos a la vez.
      for (const id of INACTIVE) {
        expect({ id, r: await code(s.query(`update public.agents set active = true where id = $1`, [id])) }).toEqual({ id, r: "23514" });
        expect({ id, r: await code(root.query(`update public.agents set active = true where id = $1`, [id])) }).toEqual({ id, r: "23514" });
      }
      expect(await code(root.query(`update public.agents set active = true`))).toBe("23514");
      expect(await code(s.query(`insert into public.agents ${NEW_AGENT} true)`))).toBe("23514");
      // Un agente nuevo inactivo sí se puede crear, y queda registrado como alta.
      await s.query(`insert into public.agents ${NEW_AGENT} false)`);
      log = await audit();
      expect(log).toHaveLength(6);
      expect(log[5]).toMatchObject({ action: "agent.created", entity_id: "nuevo", details: { cambios: { active: { antes: null, despues: false } } } });
      await root.query(`delete from public.agents where id = 'nuevo'`);

      // ── 8. Alex, Marcus y Sofia siguen activos; los seis, inactivos.
      expect(await activeIds()).toEqual([...ACTIVE_AGENT_IDS].sort());
      expect((await root.query(`select id from public.agents where not active order by id`)).rows.map((r) => r.id)).toEqual([...INACTIVE].sort());

      // ── 9. La lista aprobada no se puede cambiar desde authenticated…
      expect(await code(admin.query(`alter table public.agents drop constraint agents_active_aprobados`))).toBe("42501");
      expect(await code(s.query(`alter table public.agents drop constraint agents_active_aprobados`))).toBe("42501");
      // …y settings.pilot.agents (que el administrador SÍ puede editar) no abre la puerta.
      await admin.query(`update public.settings set value = jsonb_set(value, '{agents}', '["alex","marcus","sofia","daniel"]') where key = 'pilot'`);
      expect(await code(s.query(`update public.agents set active = true where id = 'daniel'`))).toBe("23514");
      await admin.query(`update public.settings set value = jsonb_set(value, '{agents}', '["alex","marcus","sofia"]') where key = 'pilot'`);

      // ── 10. No se puede falsificar al actor ni el registro de auditoría desde authenticated.
      expect(await code(admin.query(`insert into public.activity_log (actor_type, action, entity_type, entity_id) values ('system', 'agent.config_changed', 'agent', 'daniel')`))).toBe("42501");
      expect(await code(admin.query(`insert into public.activity_log (actor_type, actor_id, action) values ('admin', '22222222-2222-2222-2222-222222222222', 'agent.config_changed')`))).toBe("42501");
      expect(await code(admin.query(`update public.activity_log set details = '{}' where action = 'agent.config_changed'`))).toBe("42501");
      expect(await code(admin.query(`delete from public.activity_log where action = 'agent.config_changed'`))).toBe("42501");
      expect(await code(admin.query(`select public.log_agent_config_change()`))).toBe("42501");
      // Un JWT ilegible no rompe nada ni inventa actor.
      const odd = await conn(); clients.push(odd);
      await odd.query(`set role service_role; select set_config('request.jwt.claims', 'no-es-json', false)`);
      await odd.query(`update public.agents set effort = 'high' where id = 'alex'`);
      await odd.query(`update public.agents set effort = 'medium' where id = 'alex'`);
      log = await audit();
      expect(log.slice(-2).map((r) => [r.actor_type, r.actor_id, r.details.actor, r.details.origen])).toEqual([
        ["system", null, "desconocido", "desconocido"], ["system", null, "desconocido", "desconocido"],
      ]);
      expect(log).toHaveLength(8);

      // ── 11. Las demás operaciones no se ven afectadas: reclamar tareas, ajustes del administrador, tareas.
      await root.query(`insert into public.tasks (title, agent_id, status) values ('Activa', 'marcus', 'assigned'), ('Inactiva', 'daniel', 'assigned')`);
      const { rows: claimed } = await s.query(`select * from public.claim_next_task('w1', 240, 5)`);
      expect(claimed.map((r) => r.agent_id)).toEqual(["marcus"]);
      expect((await s.query(`select * from public.claim_next_task('w2', 240, 5)`)).rows).toEqual([]);
      expect(await code(admin.query(`update public.settings set value = value where key = 'limits'`))).toBe("ok");
      expect(await code(admin.query(`select id from public.tasks`))).toBe("ok");
      expect(await audit()).toHaveLength(8); // claim_next_task cambia el estado del agente, no su configuración

      // ── 13b. Marcha atrás: vuelve el permiso de 0004, se van triggers, función y restricción; el historial se conserva.
      await root.query(`update public.tasks set status = 'completed', locked_by = null, locked_until = null where status in ('assigned', 'in_progress')`);
      const auditKept = await audit();
      await root.query(ROLLBACK);
      expect(await fingerprint()).toEqual(fpBefore);
      expect(await colGrants()).toEqual(grantsBefore);
      expect(await audit()).toEqual(auditKept);
      // Y se puede volver a aplicar.
      await root.query("begin"); await root.query(MIGRATION); await root.query("commit");
      expect(new Set(await fingerprint())).toEqual(new Set(fpAfter));
      expect(await colGrants()).toEqual(grantsAfter);
    } finally {
      for (const c of clients) await c.end().catch(() => {});
      await pg.stop();
      rmSync(base, { recursive: true, force: true });
    }
  }, 240_000);
});
