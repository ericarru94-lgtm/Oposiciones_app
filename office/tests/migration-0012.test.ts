// Migración 0012 (fase 5.1.3): settings con techos económicos, piloto y reglas
// de confianza inmutables desde el navegador, y auditoría. Se prueba sobre el
// estado tras 0011 (0001–0011 + seed, con los valores de producción) en
// PostgreSQL 17.11 (la versión de producción) y 18.
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres18 from "embedded-postgres";
import EmbeddedPostgres17 from "embedded-postgres-17";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { ACTIVE_AGENT_IDS } from "@/lib/agents/catalog";
import { buildSeedSql } from "@/lib/db/seed";
import { limitsError, readCeilings } from "@/lib/domain/limits";
import { ADMIN, SUPABASE_STUB_SQL } from "./helpers/db";

const FINGERPRINT = readFileSync("supabase/checks/schema-fingerprint.sql", "utf8");
const MIGRATION = readFileSync("supabase/migrations/0012_settings_hardening.sql", "utf8");
const ROLLBACK = readFileSync("supabase/checks/0012_rollback.sql", "utf8");
// Valores de producción (consulta de solo lectura del 02/11/2026).
const PROD_LIMITS = { task_ai_budget_usd: 1, mission_ai_budget_usd: 1, monthly_ai_budget_usd: 10 };
const PROD_PILOT = { agents: ["alex", "marcus", "sofia"], max_rounds: 2, max_searches: 15, max_subtasks: 6, max_companies: 5, stop_on_cost_overrun: true, synthesis_reserve_usd: 0.25 };
const COLUMN_GRANTS = `select table_name || '.' || column_name || ':' || grantee || ':' || privilege_type v
  from information_schema.column_privileges where table_schema = 'public' and table_name = 'settings' and grantee in ('anon', 'authenticated', 'service_role') order by 1`;

describe.each([
  ["PostgreSQL 17.11 (producción)", EmbeddedPostgres17],
  ["PostgreSQL 18", EmbeddedPostgres18],
])("0012 en %s", (_label, EmbeddedPostgres) => {
  it("límites con techo, piloto y reglas inmutables, notificaciones editables, auditoría y marcha atrás", async () => {
    const base = mkdtempSync(join(tmpdir(), "mig12-")); chmodSync(base, 0o777);
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
    const asAdmin = async () => {
      const c = await conn(); clients.push(c);
      await c.query(`set role authenticated; select set_config('request.jwt.claim.sub', '${ADMIN}', false),
        set_config('request.jwt.claims', '{"role":"authenticated","sub":"${ADMIN}"}', false), set_config('request.jwt.claim.role', 'authenticated', false)`);
      return c;
    };
    const code = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return (e as { code?: string }).code ?? String(e); } };
    const setting = async (key: string) => (await root.query(`select value from public.settings where key = $1`, [key])).rows[0]?.value;
    const checksum = async (table: string) =>
      (await root.query(`select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) m from public."${table}" t`)).rows[0].m as string;
    const fingerprint = async () => new Set((await root.query<{ k: string; v: string }>(FINGERPRINT)).rows.map((r) => `${r.k}|${r.v}`));
    const colGrants = async () => (await root.query<{ v: string }>(COLUMN_GRANTS)).rows.map((r) => r.v);
    const audit = async () => (await root.query(`select actor_type, actor_id, entity_id, details from public.activity_log where action = 'settings.changed' order by id`)).rows;
    const limitsJson = (o: object) => JSON.stringify(o);
    try {
      // ── Estado tras 0011 con los valores de producción.
      await root.query(SUPABASE_STUB_SQL());
      for (const f of readdirSync("supabase/migrations").sort().filter((f) => f < "0012")) await root.query(readFileSync(`supabase/migrations/${f}`, "utf8"));
      await root.query(buildSeedSql());
      await root.query(`insert into auth.users (id, email) values ('${ADMIN}', 'admin@hesignal.test');
                        insert into public.admins (user_id, email) values ('${ADMIN}', 'admin@hesignal.test');`);
      expect(await setting("limits")).toEqual(PROD_LIMITS);
      expect(await setting("pilot")).toEqual(PROD_PILOT);
      const confidence = await setting("confidence_rules");
      const tables: Record<string, string> = {};
      for (const { relname } of (await root.query<{ relname: string }>(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'`)).rows) tables[relname] = await checksum(relname);
      const fpBefore = await fingerprint();
      const grantsBefore = await colGrants();
      // Antes de 0012 el administrador SÍ podía dejar el presupuesto sin límite o borrarlo (el riesgo).
      const pre = await asAdmin();
      await pre.query("begin");
      expect(await code(pre.query(`update public.settings set value = '{"monthly_ai_budget_usd": null, "task_ai_budget_usd": null}' where key = 'limits'`))).toBe("ok");
      expect(await code(pre.query(`delete from public.settings where key = 'limits'`))).toBe("ok");
      await pre.query("rollback");

      // ── Un valor histórico fuera de las reglas cancela la migración sin tocar nada (no se sobrescribe).
      await root.query(`update public.settings set value = '{"monthly_ai_budget_usd": null, "mission_ai_budget_usd": 1, "task_ai_budget_usd": 1}' where key = 'limits'`);
      await root.query("begin");
      await expect(root.query(MIGRATION)).rejects.toThrow(/settings\.limits no cumple las reglas/);
      await root.query("rollback");
      expect(await fingerprint()).toEqual(fpBefore);
      await root.query(`update public.settings set value = $1 where key = 'limits'`, [limitsJson(PROD_LIMITS)]);
      tables.settings = await checksum("settings");

      // ── Transaccional y aplicación real.
      await root.query("begin"); await expect(root.query(MIGRATION + "\nselect 1/0;")).rejects.toThrow(); await root.query("rollback");
      expect(await fingerprint()).toEqual(fpBefore);
      await root.query("begin"); await root.query(MIGRATION); await root.query("commit");
      // No cambia ningún dato (la fila limits ya existía; ningún valor se sobrescribe).
      for (const [t, h] of Object.entries(tables)) expect({ t, h: await checksum(t) }).toEqual({ t, h });

      // Permisos: authenticated sin INSERT/DELETE y UPDATE solo de la columna value.
      const fpAfter = await fingerprint();
      expect([...fpBefore].filter((x) => !fpAfter.has(x)).filter((x) => x.startsWith("grant|"))).toEqual(["grant|settings:authenticated:DELETE,INSERT,SELECT,UPDATE"]);
      expect([...fpAfter].filter((x) => !fpBefore.has(x)).filter((x) => x.startsWith("grant|"))).toEqual(["grant|settings:authenticated:SELECT"]);
      expect((await colGrants()).filter((g) => g.includes(":authenticated:UPDATE"))).toEqual(["settings.value:authenticated:UPDATE"]);
      expect([...fpBefore].filter((x) => !fpAfter.has(x)).filter((x) => x.startsWith("pol|") || x.startsWith("rls|"))).toEqual([]);
      // Una sola SECURITY DEFINER nueva (la de auditoría), sin EXECUTE para la API.
      const newDefiners = [...fpAfter].filter((x) => !fpBefore.has(x) && /^fn\|.*\):true:/.test(x));
      expect(newDefiners.map((x) => x.split("(")[0])).toEqual(["fn|log_settings_change"]);
      expect([...fpAfter].filter((x) => x.startsWith("fexec|log_settings_change()") || x.startsWith("fexec|settings_guard()"))
        .every((x) => x.endsWith(":false"))).toBe(true);
      // Validador y techos: funciones puras, ejecutables por authenticated y service_role (no por anon).
      expect([...fpAfter].filter((x) => x.startsWith("fexec|settings_value_error(") || x.startsWith("fexec|settings_ceilings(")).sort()).toEqual([
        "fexec|settings_ceilings():anon:false", "fexec|settings_ceilings():authenticated:true", "fexec|settings_ceilings():service_role:true",
        "fexec|settings_value_error(p_key text, p_value jsonb):anon:false", "fexec|settings_value_error(p_key text, p_value jsonb):authenticated:true",
        "fexec|settings_value_error(p_key text, p_value jsonb):service_role:true",
      ]);
      // La lista de agentes de los techos es ACTIVE_AGENT_IDS.
      const ceilings = (await root.query(`select public.settings_ceilings() c`)).rows[0].c;
      expect([...ceilings.agents].sort()).toEqual([...ACTIVE_AGENT_IDS].sort());

      const admin = await asAdmin();
      const s = await svc();
      const updLimits = (c: Client, v: object) => c.query(`update public.settings set value = $1 where key = 'limits'`, [limitsJson(v)]);

      // ── 1. No se puede borrar limits (ni pilot ni confidence_rules), ni vaciar la tabla, ni renombrar.
      expect(await code(admin.query(`delete from public.settings where key = 'limits'`))).toBe("42501");
      for (const c of [s, root]) for (const key of ["limits", "pilot", "confidence_rules"]) {
        expect({ key, r: await code(c.query(`delete from public.settings where key = $1`, [key])) }).toEqual({ key, r: "42501" });
      }
      for (const c of [admin, s, root]) expect(await code(c.query(`truncate public.settings`))).toBe("42501");
      expect(await code(root.query(`update public.settings set key = 'limites' where key = 'limits'`))).toBe("42501");
      expect(await code(admin.query(`update public.settings set key = 'x' where key = 'notifications'`))).toBe("42501"); // solo la columna value
      expect(await setting("limits")).toEqual(PROD_LIMITS);

      // ── 2–4. Ni NULL, ni negativos, ni por encima del techo, ni tarea/misión > mensual: ningún rol.
      const bad = [
        { monthly_ai_budget_usd: null, mission_ai_budget_usd: 1, task_ai_budget_usd: 1 },
        { monthly_ai_budget_usd: 10, mission_ai_budget_usd: 1 },                                   // falta uno
        { monthly_ai_budget_usd: 10, mission_ai_budget_usd: 1, task_ai_budget_usd: 1, extra: 1 },
        { monthly_ai_budget_usd: "10", mission_ai_budget_usd: 1, task_ai_budget_usd: 1 },          // texto
        { monthly_ai_budget_usd: -1, mission_ai_budget_usd: 1, task_ai_budget_usd: 1 },
        { monthly_ai_budget_usd: 10, mission_ai_budget_usd: -0.01, task_ai_budget_usd: 1 },
        { monthly_ai_budget_usd: 10.01, mission_ai_budget_usd: 1, task_ai_budget_usd: 1 },
        { monthly_ai_budget_usd: 10, mission_ai_budget_usd: 1.01, task_ai_budget_usd: 1 },
        { monthly_ai_budget_usd: 10, mission_ai_budget_usd: 1, task_ai_budget_usd: 1000 },
        { monthly_ai_budget_usd: 0.5, mission_ai_budget_usd: 0.5, task_ai_budget_usd: 1 },         // tarea > mensual
        { monthly_ai_budget_usd: 0.5, mission_ai_budget_usd: 1, task_ai_budget_usd: 0.5 },         // misión > mensual
      ];
      for (const v of bad) for (const [who, c] of [["admin", admin], ["service_role", s], ["postgres", root]] as const) {
        expect({ who, v, r: await code(updLimits(c, v)) }).toEqual({ who, v, r: "23514" });
      }
      expect(await code(root.query(`update public.settings set value = 'null'::jsonb where key = 'limits'`))).toBe("23514");
      expect(await setting("limits")).toEqual(PROD_LIMITS);

      // ── 6 y 12. Se pueden reducir dentro del rango (y volver al techo), y cada cambio queda auditado.
      await updLimits(admin, { monthly_ai_budget_usd: 5, mission_ai_budget_usd: 0.5, task_ai_budget_usd: 0.25 });
      await updLimits(admin, PROD_LIMITS);
      await updLimits(admin, PROD_LIMITS); // sin cambios: no se audita
      let log = await audit();
      expect(log).toHaveLength(2);
      expect(log[0]).toEqual({
        actor_type: "admin", actor_id: ADMIN, entity_id: "limits",
        details: {
          operacion: "update", antes: PROD_LIMITS, despues: { monthly_ai_budget_usd: 5, mission_ai_budget_usd: 0.5, task_ai_budget_usd: 0.25 },
          actor: ADMIN, origen: "api (usuario autenticado)", rol_jwt: "authenticated", registrado_por: "trigger settings_audit (0012)",
        },
      });
      expect(log[1].details.despues).toEqual(PROD_LIMITS);

      // ── 5 y 7. pilot no se puede modificar desde el navegador; y nadie puede desactivar la parada ni ampliar topes.
      const pilotPatch = (patch: object) => `update public.settings set value = value || '${JSON.stringify(patch)}'::jsonb where key = 'pilot'`;
      expect((await admin.query(pilotPatch({ max_searches: 10 }))).rowCount).toBe(0);         // la fila no es visible para UPDATE
      expect((await admin.query(pilotPatch({ stop_on_cost_overrun: false }))).rowCount).toBe(0);
      expect(await code(admin.query(`insert into public.settings (key, value) values ('pilot2', '{}')`))).toBe("42501");
      for (const c of [s, root]) {
        for (const patch of [
          { stop_on_cost_overrun: false }, { max_searches: 16 }, { max_rounds: 3 }, { max_subtasks: 7 }, { max_companies: 6 },
          { synthesis_reserve_usd: -0.01 }, { synthesis_reserve_usd: 0.26 }, { max_rounds: 1.5 }, { agents: ["alex", "daniel"] },
        ]) expect({ patch, r: await code(c.query(pilotPatch(patch))) }).toEqual({ patch, r: "23514" });
      }
      expect(await setting("pilot")).toEqual(PROD_PILOT);
      // Una operación interna autorizada puede REDUCIR un tope del piloto (y queda auditada como sistema).
      await s.query(pilotPatch({ max_searches: 10 }));
      await s.query(pilotPatch({ max_searches: 15 }));
      log = await audit();
      expect(log.slice(-2).map((r) => [r.actor_type, r.actor_id, r.entity_id, r.details.origen])).toEqual([
        ["system", null, "pilot", "api (service_role: servidor de la oficina)"], ["system", null, "pilot", "api (service_role: servidor de la oficina)"],
      ]);
      expect(await setting("pilot")).toEqual(PROD_PILOT);

      // ── 8. confidence_rules no se puede modificar desde el navegador.
      expect((await admin.query(`update public.settings set value = jsonb_set(value, '{base,inference}', '99') where key = 'confidence_rules'`)).rowCount).toBe(0);
      expect(await setting("confidence_rules")).toEqual(confidence);

      // ── 9. notifications sigue siendo editable (y solo admite sí/no).
      expect((await admin.query(`update public.settings set value = '{"approvals": true, "failures": false}' where key = 'notifications'`)).rowCount).toBe(1);
      expect(await code(admin.query(`update public.settings set value = '{"approvals": "sí"}' where key = 'notifications'`))).toBe("23514");
      await admin.query(`update public.settings set value = '{"approvals": true, "failures": true}' where key = 'notifications'`);

      // ── Falsificación: el administrador no puede escribir settings.changed por su cuenta (0011), ni llamar a las funciones.
      expect(await code(admin.query(`insert into public.activity_log (actor_type, actor_id, action, entity_id) values ('admin', $1, 'settings.changed', 'limits')`, [ADMIN]))).toBe("42501");
      for (const fn of ["public.log_settings_change()", "public.settings_guard()"]) {
        expect({ fn, r: await code(admin.query(`select ${fn}`)) }).toEqual({ fn, r: "42501" });
      }

      // ── 10. El seed y las migraciones siguen funcionando, sin cambios ni auditoría si nada cambia.
      const before10 = (await audit()).length;
      await root.query(buildSeedSql());
      expect((await audit()).length).toBe(before10);
      expect(await setting("limits")).toEqual(PROD_LIMITS);

      // ── 11. El motor sigue aplicando los límites: con 0 $ al mes no reclama; al volver a 10 $, sí.
      await root.query(`insert into public.tasks (title, agent_id, status) values ('Prueba', 'marcus', 'assigned')`);
      await updLimits(admin, { monthly_ai_budget_usd: 0, mission_ai_budget_usd: 0, task_ai_budget_usd: 0 });
      expect((await s.query(`select exceeded from public.ai_budget_status()`)).rows[0].exceeded).toBe(true);
      expect((await s.query(`select * from public.claim_next_task('w1', 240, 5)`)).rows).toEqual([]);
      await updLimits(admin, PROD_LIMITS);
      expect((await s.query(`select exceeded, monthly_limit_usd::float m, task_limit_usd::float t from public.ai_budget_status()`)).rows[0]).toEqual({ exceeded: false, m: 10, t: 1 });
      expect((await s.query(`select * from public.claim_next_task('w1', 240, 5)`)).rows).toHaveLength(1);

      // ── El validador del servidor (TypeScript) coincide con el de PostgreSQL caso a caso, con los mismos techos.
      const tsCeilings = readCeilings(ceilings)!;
      expect(tsCeilings).toEqual(PROD_LIMITS);
      const cases = [...bad.filter((v) => Object.keys(v).length === 3 && Object.values(v).every((x) => x === null || typeof x === "number")),
        PROD_LIMITS, { monthly_ai_budget_usd: 0, mission_ai_budget_usd: 0, task_ai_budget_usd: 0 },
        { monthly_ai_budget_usd: 1, mission_ai_budget_usd: 1, task_ai_budget_usd: 1 }, { monthly_ai_budget_usd: 9.99, mission_ai_budget_usd: 0.01, task_ai_budget_usd: 1 }];
      for (const v of cases) {
        const sqlOk = (await root.query(`select public.settings_value_error('limits', $1::jsonb) e`, [limitsJson(v)])).rows[0].e === null;
        expect({ v, ts: limitsError(v as never, tsCeilings) === null }).toEqual({ v, ts: sqlOk });
      }

      // ── 13. Marcha atrás: permisos, políticas y triggers como tras 0011; datos y auditoría intactos. Y se puede reaplicar.
      await root.query(`update public.tasks set status = 'completed', locked_by = null, locked_until = null where status <> 'completed'`);
      const settingsNow = await checksum("settings");
      const auditNow = await audit();
      await root.query(ROLLBACK);
      expect(await fingerprint()).toEqual(fpBefore);
      expect(await colGrants()).toEqual(grantsBefore);
      expect(await checksum("settings")).toBe(settingsNow);
      expect(await audit()).toEqual(auditNow);
      await root.query("begin"); await root.query(MIGRATION); await root.query("commit");
      expect(new Set(await fingerprint())).toEqual(new Set(fpAfter));
    } finally {
      for (const c of clients) await c.end().catch(() => {});
      await pg.stop();
      rmSync(base, { recursive: true, force: true });
    }
  }, 240_000);
});
