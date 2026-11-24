// Vuelca la definición EFECTIVA (tras 0001–0014) de las funciones que tocan tareas,
// ejecuciones, reservas, consumo o límites. Solo lectura sobre una base local temporal.
import { writeFileSync } from "node:fs";
import { startLab } from "./pi16-pglab.mjs";
const out = process.argv[2] ?? "funciones-efectivas.sql";
const lab = await startLab("pi16-dump-");
try {
  console.log(await lab.isolation());
  await lab.applyMigrations();
  const rows = (await lab.admin.query(`
    select p.proname, pg_get_function_identity_arguments(p.oid) args, pg_get_functiondef(p.oid) def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and pg_get_functiondef(p.oid) ~* '(public\\.)?(tasks|agent_runs|ai_reservations|ai_usage|settings|web_tool_events)\\M'
     order by 1, 2`)).rows;
  writeFileSync(out, rows.map((r) => `-- ===== ${r.proname}(${r.args})\n${r.def}`).join("\n\n"));
  console.log(rows.map((r) => `${r.proname}(${r.args.slice(0, 60)})`).join("\n"));
} finally { await lab.stop(); }
