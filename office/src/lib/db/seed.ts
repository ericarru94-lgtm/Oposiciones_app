// Genera supabase/seed.sql a partir del registro de agentes y de la memoria
// global. Es idempotente: se puede ejecutar varias veces sin duplicar datos y
// sin pisar el estado en tiempo real de los agentes.

import { AGENTS, isActiveAgent } from "../agents/registry";
import { GLOBAL_MEMORY } from "../agents/company-memory";

function lit(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function textArray(values: readonly string[]): string {
  return `array[${values.map(lit).join(", ")}]::text[]`;
}

function json(value: unknown): string {
  return `${lit(JSON.stringify(value))}::jsonb`;
}

export function buildSeedSql(): string {
  const agentRows = AGENTS.map(
    (a) =>
      `  (${[
        lit(a.id),
        lit(a.name),
        lit(a.role),
        lit(a.department),
        lit(a.specialty),
        lit(a.description),
        lit(a.personality),
        lit(a.instructions),
        textArray(a.tools),
        lit(a.model),
        lit(a.effort),
        a.isCoordinator ? "true" : "false",
        isActiveAgent(a.id) ? "true" : "false",
        json(a.avatar),
        json(a.desk),
      ].join(", ")})`,
  ).join(",\n");

  const memoryRows = GLOBAL_MEMORY.map(
    (m) => `  ('global', ${lit(m.category)}, ${lit(m.title)}, ${lit(m.content)}, ${lit(m.source)}, 'seed')`,
  ).join(",\n");

  return `-- Archivo generado por \`npm run db:seed\`. No lo edites a mano:
-- cambia src/lib/agents/registry.ts o src/lib/agents/company-memory.ts.

insert into public.agents
  (id, name, role, department, specialty, description, personality, instructions,
   tools, model, effort, is_coordinator, active, avatar, desk)
values
${agentRows}
on conflict (id) do update set
  name = excluded.name,
  role = excluded.role,
  department = excluded.department,
  specialty = excluded.specialty,
  description = excluded.description,
  personality = excluded.personality,
  instructions = excluded.instructions,
  tools = excluded.tools,
  model = excluded.model,
  effort = excluded.effort,
  is_coordinator = excluded.is_coordinator,
  active = excluded.active,
  avatar = excluded.avatar,
  desk = excluded.desk;
-- El modelo, el esfuerzo y si el agente está activo se definen en el código
-- (registry.ts y ACTIVE_AGENT_IDS en catalog.ts) y se sincronizan aquí.

insert into public.memory_items (scope, category, title, content, source, created_by)
values
${memoryRows}
on conflict do nothing;

insert into public.settings (key, value) values
  ('limits', '{"monthly_ai_budget_usd": 10, "mission_ai_budget_usd": 1, "task_ai_budget_usd": 1}'::jsonb),
  ('notifications', '{"approvals": true, "failures": true}'::jsonb)
on conflict (key) do nothing;
`;
}
