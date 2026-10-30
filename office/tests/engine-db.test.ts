// Seguridad y motor de ejecución sobre las migraciones reales (PGlite).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ADMIN, INTRUDER, createTestDb, type TestDb } from "./helpers/db";

let t: TestDb;
const q = async <T,>(sql: string, params: unknown[] = []) => (await t.db.query<T>(sql, params)).rows;
const svc = <T,>(sql: string, params: unknown[] = []) => t.asService(() => q<T>(sql, params));

beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t?.close();
});
beforeEach(async () => {
  await t.db.exec(`
    delete from public.tasks;
    delete from public.ai_usage;
    update public.settings set value = '{"monthly_ai_budget_usd": null, "task_ai_budget_usd": null}' where key = 'limits';
    update public.agents set status = 'available', current_task_id = null;
  `);
});

async function newTask(agent: string, extra: Record<string, unknown> = {}) {
  const cols = ["title", "agent_id", "status", ...Object.keys(extra)];
  const vals = [`Tarea de ${agent}`, agent, "assigned", ...Object.values(extra)];
  const rows = await q<{ id: string }>(
    `insert into public.tasks (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
    vals,
  );
  return rows[0].id;
}

type Claim = { task_id: string; run_id: string; agent_id: string; attempt: number; resumed: boolean };
const claim = (worker = "w1", lease = 240, max = 5) =>
  svc<Claim>(`select * from public.claim_next_task($1, $2, $3)`, [worker, lease, max]);

describe("permisos de funciones", () => {
  const engineFns = [
    "claim_next_task(text, integer, integer)",
    "consume_approval(uuid, uuid, text, text, jsonb)",
    "record_step(uuid, text, jsonb, text, bigint, bigint, bigint, bigint, integer, numeric, agent_status, boolean)",
    "complete_run(uuid, text, text, jsonb)",
    "fail_run(uuid, text, text, boolean)",
    "recover_stale()",
    "memory_for_task(uuid)",
    "set_agent_state(text, agent_status, uuid, text)",
  ];

  it("solo service_role puede ejecutar el motor", async () => {
    for (const fn of engineFns) {
      const [r] = await q<{ anon: boolean; auth: boolean; svc: boolean }>(
        `select has_function_privilege('anon', 'public.${fn}', 'execute') as anon,
                has_function_privilege('authenticated', 'public.${fn}', 'execute') as auth,
                has_function_privilege('service_role', 'public.${fn}', 'execute') as svc`,
      );
      expect({ fn, ...r }).toEqual({ fn, anon: false, auth: false, svc: true });
    }
  });

  it("las funciones SECURITY DEFINER son solo las previstas y todas fijan search_path", async () => {
    const rows = await q<{ name: string; config: string[] | null }>(
      `select p.proname as name, p.proconfig as config from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where p.prosecdef and n.nspname in ('public', 'private') order by 1`,
    );
    expect(rows.map((r) => r.name)).toEqual(["decide_approval", "is_admin", "link_admin", "memory_items_versioning"]);
    for (const r of rows) expect(r.config).toContain("search_path=\"\"");
  });

  it("todas las funciones de public y private fijan search_path", async () => {
    const rows = await q<{ name: string }>(
      `select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private')
          and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`,
    );
    expect(rows).toEqual([]);
  });

  it("todas las tablas de public tienen RLS activado", async () => {
    const rows = await q<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(rows).toEqual([]);
  });

  it("anon no puede llamar a decide_approval ni leer vistas de costes", async () => {
    const [r] = await q<{ fn: boolean; v: boolean }>(
      `select has_function_privilege('anon', 'public.decide_approval(uuid, boolean, text)', 'execute') as fn,
              has_table_privilege('anon', 'public.ai_cost_monthly', 'select') as v`,
    );
    expect(r).toEqual({ fn: false, v: false });
  });
});

describe("escrituras del navegador", () => {
  it("el administrador no puede fingir estados de los agentes", async () => {
    await expect(
      t.as(ADMIN, () => q(`update public.agents set status = 'working' where id = 'alex'`)),
    ).rejects.toThrow(/permission denied/);
    await t.as(ADMIN, () => q(`update public.agents set model = 'claude-haiku-5-5' where id = 'oscar'`));
    expect((await q<{ model: string }>(`select model from public.agents where id = 'oscar'`))[0].model).toBe(
      "claude-haiku-5-5",
    );
    await q(`update public.agents set model = 'claude-opus-5-5' where id = 'oscar'`);
  });

  it("el administrador crea tareas pero no puede saltarse el motor", async () => {
    await t.as(ADMIN, () => q(`insert into public.tasks (title, agent_id, status) values ('Plan', 'sofia', 'assigned')`));
    await expect(
      t.as(ADMIN, () => q(`insert into public.tasks (title, agent_id, status) values ('x', 'sofia', 'completed')`)),
    ).rejects.toThrow(/row-level security/);
    await expect(
      t.as(ADMIN, () => q(`update public.tasks set status = 'completed'`)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      t.as(ADMIN, () => q(`insert into public.ai_usage (model, cost_usd) values ('x', 0)`)),
    ).rejects.toThrow(/permission denied/);
  });

  it("el registro de actividad solo acepta el propio usuario como autor", async () => {
    await expect(
      t.as(ADMIN, () =>
        q(`insert into public.activity_log (actor_type, actor_id, action) values ('admin', '${INTRUDER}', 'x')`),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("evita tareas duplicadas con la clave de idempotencia", async () => {
    await newTask("marcus", { idempotency_key: "alex:plan-gimnasios:1" });
    await expect(newTask("marcus", { idempotency_key: "alex:plan-gimnasios:1" })).rejects.toThrow(/duplicate key/);
  });

  it("impide dependencias circulares", async () => {
    const a = await newTask("marcus");
    const b = await newTask("daniel");
    await q(`insert into public.task_dependencies values ($1, $2)`, [b, a]);
    await expect(q(`insert into public.task_dependencies values ($1, $2)`, [a, b])).rejects.toThrow(/ciclo/);
  });
});

describe("motor de ejecución", () => {
  it("adquiere tareas sin duplicarlas y una sola por agente", async () => {
    await newTask("marcus");
    await newTask("marcus");
    await newTask("sofia");
    const first = await claim("w1");
    const second = await claim("w2");
    const third = await claim("w3");
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(second[0].agent_id).not.toBe(first[0].agent_id);
    expect(third).toHaveLength(0); // la segunda de Marcus espera a que termine la primera
    const [agent] = await q<{ status: string }>(`select status from public.agents where id = $1`, [first[0].agent_id]);
    expect(agent.status).toBe("working");
  });

  it("respeta el límite de ejecuciones simultáneas", async () => {
    await newTask("marcus");
    await newTask("sofia");
    expect(await claim("w1", 240, 1)).toHaveLength(1);
    expect(await claim("w2", 240, 1)).toHaveLength(0);
  });

  it("respeta las dependencias", async () => {
    const research = await newTask("marcus");
    const messages = await newTask("daniel");
    await q(`insert into public.task_dependencies values ($1, $2)`, [messages, research]);
    const [c] = await claim();
    expect(c.task_id).toBe(research);
    expect(await claim("w2")).toHaveLength(0);
    await svc(`select public.complete_run($1, 'w1', 'Lista de 10 gimnasios')`, [c.run_id]);
    const [next] = await claim("w2");
    expect(next.task_id).toBe(messages);
  });

  it("solo el dueño del lease puede guardar resultados", async () => {
    await newTask("oscar");
    const [c] = await claim("w1");
    await expect(svc(`select public.complete_run($1, 'otro', 'x')`, [c.run_id])).rejects.toThrow(/lease perdido/);
  });

  it("recupera una tarea abandonada cuando caduca el lease", async () => {
    const id = await newTask("emma");
    const [c] = await claim("w1", 30);
    await q(`update public.tasks set locked_until = now() - interval '1 second' where id = $1`, [id]);
    const [again] = await claim("w2");
    expect(again).toMatchObject({ task_id: id, run_id: c.run_id, resumed: true });
    const [run] = await q<{ recoveries: number; worker_id: string }>(
      `select recoveries, worker_id from public.agent_runs where id = $1`, [c.run_id],
    );
    expect(run).toEqual({ recoveries: 1, worker_id: "w2" });
    await expect(svc(`select public.heartbeat_run($1, 'w1')`, [c.run_id])).rejects.toThrow(/lease perdido/);
  });

  it("reintenta con espera y se detiene al agotar los intentos", async () => {
    const id = await newTask("lucia", { max_attempts: 2 });
    const [c1] = await claim();
    expect((await svc<{ s: string }>(`select public.fail_run($1, 'w1', 'Error 529', true) as s`, [c1.run_id]))[0].s).toBe("assigned");
    expect(await claim()).toHaveLength(0); // espera de reintento
    await q(`update public.tasks set run_after = now() where id = $1`, [id]);
    const [c2] = await claim();
    expect(c2.attempt).toBe(2);
    expect((await svc<{ s: string }>(`select public.fail_run($1, 'w1', 'Error 529', true) as s`, [c2.run_id]))[0].s).toBe("failed");
    const [agent] = await q<{ status: string }>(`select status from public.agents where id = 'lucia'`);
    expect(agent.status).toBe("blocked");
  });

  it("corta las tareas que superan su tiempo máximo", async () => {
    const id = await newTask("david");
    await claim();
    await q(`update public.tasks set started_at = now() - interval '2 hours', timeout_seconds = 60 where id = $1`, [id]);
    const [r] = await svc<{ recover_stale: { timed_out_tasks: number } }>(`select public.recover_stale()`);
    expect(r.recover_stale.timed_out_tasks).toBe(1);
    expect((await q<{ status: string }>(`select status from public.tasks where id = $1`, [id]))[0].status).toBe("failed");
  });

  it("si la tarea requiere revisión, pasa a control de calidad", async () => {
    const id = await newTask("daniel", { requires_review: true });
    const [c] = await claim();
    expect((await svc<{ s: string }>(`select public.complete_run($1, 'w1', 'Guion') as s`, [c.run_id]))[0].s).toBe("in_review");
    await svc(`select public.record_review($1, 'victoria', true, 'Aprobado')`, [id]);
    expect((await q<{ status: string }>(`select status from public.tasks where id = $1`, [id]))[0].status).toBe("completed");
  });

  it("registra consumo y para al alcanzar el presupuesto", async () => {
    await q(`update public.settings set value = '{"monthly_ai_budget_usd": 1, "task_ai_budget_usd": 0.5}' where key = 'limits'`);
    await newTask("alex");
    const [c] = await claim();
    const step = (cost: number) =>
      svc<{ r: { continue: boolean; reason?: string } }>(
        `select public.record_step($1, 'w1', '{}', 'claude-sonnet-5-5', 1000, 200, 0, 0, 0, $2) as r`,
        [c.run_id, cost],
      );
    expect((await step(0.2))[0].r.continue).toBe(true);
    expect((await step(0.4))[0].r).toMatchObject({ continue: false, reason: "task_budget" });
    await svc(`select public.complete_run($1, 'w1', 'ok')`, [c.run_id]);
    await q(`insert into public.ai_usage (model, cost_usd) values ('claude-opus-5-5', 1)`);
    await newTask("marcus");
    expect(await claim()).toHaveLength(0); // presupuesto mensual agotado
    const [m] = await q<{ cost_usd: string; model_calls: string }>(
      `select sum(cost_usd)::text as cost_usd, sum(model_calls)::text as model_calls from public.ai_cost_monthly where agent_id = 'alex'`,
    );
    expect(Number(m.cost_usd)).toBeCloseTo(0.6);
    expect(Number(m.model_calls)).toBe(2);
  });
});

describe("aprobaciones", () => {
  async function pendingApproval(args: object) {
    await newTask("marcus");
    const [c] = await claim();
    const [{ id }] = await svc<{ id: string }>(
      `select public.request_approval($1, 'w1', 'toolu_1', 'email.send', 'external_action', 'send', $2, 'Enviar propuesta') as id`,
      [c.run_id, JSON.stringify(args)],
    );
    await svc(`select public.pause_for_approval($1, 'w1', '{}')`, [c.run_id]);
    return { approvalId: id, runId: c.run_id, taskId: c.task_id };
  }
  const consume = (approvalId: string, runId: string, args: object, tool = "email.send", action = "send") =>
    svc<{ ok: boolean }>(`select public.consume_approval($1, $2, $3, $4, $5) as ok`, [
      approvalId, runId, tool, action, JSON.stringify(args),
    ]).then((r) => r[0].ok);

  const ARGS = { to: "gimnasio@example.com", subject: "Propuesta", body: "Hola" };

  it("pausa la tarea y bloquea al agente hasta que decides", async () => {
    const { taskId } = await pendingApproval(ARGS);
    expect((await q<{ status: string }>(`select status from public.tasks where id = $1`, [taskId]))[0].status).toBe("needs_approval");
    expect((await q<{ status: string }>(`select status from public.agents where id = 'marcus'`))[0].status).toBe("blocked");
  });

  it("es idempotente por llamada de herramienta", async () => {
    const { approvalId, runId } = await pendingApproval(ARGS);
    await q(`update public.tasks set status = 'in_progress', locked_by = 'w1', locked_until = now() + interval '1 minute'`);
    await q(`update public.agent_runs set status = 'running' where id = $1`, [runId]);
    const [{ id }] = await svc<{ id: string }>(
      `select public.request_approval($1, 'w1', 'toolu_1', 'email.send', 'external_action', 'send', $2, 'otra vez') as id`,
      [runId, JSON.stringify(ARGS)],
    );
    expect(id).toBe(approvalId);
  });

  it("no se puede usar sin aprobar, ni con otros argumentos, ni dos veces", async () => {
    const { approvalId, runId, taskId } = await pendingApproval(ARGS);
    expect(await consume(approvalId, runId, ARGS)).toBe(false); // pendiente
    await t.as(ADMIN, () => q(`select public.decide_approval($1, true, 'OK')`, [approvalId]));
    expect((await q<{ status: string }>(`select status from public.tasks where id = $1`, [taskId]))[0].status).toBe("in_progress");
    expect(await consume(approvalId, runId, { ...ARGS, body: "Hola, cambiado" })).toBe(false);
    expect(await consume(approvalId, runId, ARGS, "outreach.contact")).toBe(false);
    // El orden de las claves no altera la huella.
    expect(await consume(approvalId, runId, { body: "Hola", subject: "Propuesta", to: "gimnasio@example.com" })).toBe(true);
    expect(await consume(approvalId, runId, ARGS)).toBe(false); // un solo uso
    const [a] = await q<{ decided_by: string; consumed_at: string | null; args_hash: string }>(
      `select decided_by, consumed_at, args_hash from public.approvals where id = $1`, [approvalId],
    );
    expect(a.decided_by).toBe(ADMIN);
    expect(a.consumed_at).not.toBeNull();
    expect(a.args_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("los argumentos aprobados no se pueden editar después", async () => {
    const { approvalId } = await pendingApproval(ARGS);
    await expect(
      q(`update public.approvals set arguments = '{"to": "otro@example.com"}' where id = $1`, [approvalId]),
    ).rejects.toThrow(/no se puede modificar/);
  });

  it("nace siempre pendiente aunque se intente insertar aprobada", async () => {
    await newTask("emma");
    const [c] = await claim();
    await q(
      `insert into public.approvals (agent_id, run_id, tool_id, risk, summary, status, arguments)
       values ('emma', $1, 'email.send', 'external_action', 'x', 'approved', '{}')`,
      [c.run_id],
    );
    const [a] = await q<{ status: string }>(`select status from public.approvals where run_id = $1`, [c.run_id]);
    expect(a.status).toBe("pending");
  });

  it("solo el administrador decide, una vez y antes de que caduque", async () => {
    const { approvalId } = await pendingApproval(ARGS);
    await expect(
      t.as(INTRUDER, () => q(`select public.decide_approval($1, true)`, [approvalId])),
    ).rejects.toThrow(/No autorizado/);
    await t.as(ADMIN, () => q(`select public.decide_approval($1, false, 'No')`, [approvalId]));
    await expect(
      t.as(ADMIN, () => q(`select public.decide_approval($1, true)`, [approvalId])),
    ).rejects.toThrow(/ya se decidió/);
  });

  it("caduca y falla la tarea si nadie decide a tiempo", async () => {
    const { approvalId, taskId } = await pendingApproval(ARGS);
    await t.db.exec(`alter table public.approvals disable trigger approvals_guard`);
    await q(`update public.approvals set expires_at = now() - interval '1 minute' where id = $1`, [approvalId]);
    await t.db.exec(`alter table public.approvals enable trigger approvals_guard`);
    await svc(`select public.recover_stale()`);
    const [a] = await q<{ status: string }>(`select status from public.approvals where id = $1`, [approvalId]);
    expect(a.status).toBe("expired");
    expect((await q<{ status: string }>(`select status from public.tasks where id = $1`, [taskId]))[0].status).toBe("failed");
  });
});

describe("memoria y documentos", () => {
  it("guarda las versiones anteriores de una memoria", async () => {
    await t.as(ADMIN, () =>
      q(`update public.memory_items set content = 'Tarifas: piloto 1' where title = 'Tarifas'`),
    );
    const [v] = await q<{ version: number; content: string }>(
      `select v.version, v.content from public.memory_item_versions v
         join public.memory_items m on m.id = v.memory_item_id where m.title = 'Tarifas'`,
    );
    expect(v.version).toBe(1);
    expect(v.content).toMatch(/^PENDIENTE/);
    expect((await q<{ version: number }>(`select version from public.memory_items where title = 'Tarifas'`))[0].version).toBe(2);
    await expect(
      t.as(ADMIN, () => q(`insert into public.memory_item_versions (memory_item_id, version, category, title, content, source)
                            select id, 99, 'x', 'x', 'x', 'x' from public.memory_items limit 1`)),
    ).rejects.toThrow(/row-level security/);
  });

  it("un agente solo ve la memoria del cliente de su tarea", async () => {
    const [a] = await q<{ id: string }>(`insert into public.companies (name, source, is_demo) values ('DEMO Box A', 'prueba', true) returning id`);
    const [b] = await q<{ id: string }>(`insert into public.companies (name, source, is_demo) values ('DEMO Box B', 'prueba', true) returning id`);
    await q(`insert into public.memory_items (scope, client_id, category, title, content, source, is_demo) values
             ('client', $1, 'clients', 'Ficha A', 'secreto A', 'prueba', true),
             ('client', $2, 'clients', 'Ficha B', 'secreto B', 'prueba', true)`, [a.id, b.id]);
    const task = await newTask("emma", { client_id: a.id });
    const rows = await svc<{ title: string }>(`select title from public.memory_for_task($1)`, [task]);
    const titles = rows.map((r) => r.title);
    expect(titles).toContain("Ficha A");
    expect(titles).not.toContain("Ficha B");
    expect(titles).toContain("Identidad de marca");
  });

  it("los documentos y su bucket son privados del administrador", async () => {
    const [bucket] = await q<{ public: boolean }>(`select public from storage.buckets where id = 'documents'`);
    expect(bucket.public).toBe(false);
    await q(`insert into storage.objects (bucket_id, name) values ('documents', 'tareas/plan.pdf')`);
    expect(await t.as(INTRUDER, () => q(`select * from storage.objects`))).toHaveLength(0);
    expect(await t.as(ADMIN, () => q(`select * from storage.objects`))).toHaveLength(1);
    await t.as(ADMIN, () =>
      q(`insert into public.documents (title, kind, content, source) values ('Plan', 'strategy', '# Plan', 'tarea')`),
    );
    expect(await t.as(INTRUDER, () => q(`select * from public.documents`))).toHaveLength(0);
    await expect(
      q(`insert into public.documents (title, kind, source) values ('Vacío', 'report', 'x')`),
    ).rejects.toThrow(/check constraint/);
  });
});
