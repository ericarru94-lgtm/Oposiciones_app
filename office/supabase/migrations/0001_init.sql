-- HE SIGNAL AI OFFICE · esquema inicial (fase 1)
--
-- Seguridad:
--   * Todas las tablas tienen Row Level Security activado.
--   * Solo los usuarios presentes en public.admins (el administrador de
--     HE Signal) pueden leer o escribir desde el navegador.
--   * El ejecutor de agentes trabaja en el servidor con la clave secreta
--     (service role), que nunca llega al navegador.
--   * activity_log es solo de inserción: no se puede editar ni borrar.

-- ───────────────────────────── Tipos ─────────────────────────────

create type public.agent_status as enum
  ('available', 'working', 'thinking', 'reviewing', 'blocked', 'completed');

create type public.task_status as enum
  ('pending', 'assigned', 'in_progress', 'in_review', 'needs_approval', 'completed', 'failed');

create type public.task_priority as enum ('low', 'normal', 'high', 'urgent');

create type public.memory_scope as enum ('global', 'agent', 'client', 'project');

create type public.approval_status as enum ('pending', 'approved', 'rejected', 'expired');

create type public.crm_stage as enum
  ('prospect', 'researched', 'contacted', 'interested', 'proposal', 'negotiation', 'won', 'lost');

-- ─────────────────────────── Utilidades ──────────────────────────

create function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ───────────────────────── Administradores ───────────────────────

create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  created_at timestamptz not null default now()
);

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins where user_id = (select auth.uid()));
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- ───────────────────────────── Agentes ───────────────────────────

create table public.agents (
  id text primary key check (id ~ '^[a-z][a-z0-9_-]*$'),
  name text not null,
  role text not null,
  department text not null,
  specialty text not null,
  description text not null,
  personality text not null,
  instructions text not null,
  tools text[] not null default '{}',
  model text not null,
  effort text not null default 'medium' check (effort in ('low', 'medium', 'high')),
  is_coordinator boolean not null default false,
  avatar jsonb not null default '{}',
  desk jsonb not null default '{}',
  active boolean not null default true,
  -- Estado en tiempo real: solo lo escribe el ejecutor de agentes.
  status public.agent_status not null default 'available',
  status_detail text,
  current_task_id uuid,
  status_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger agents_updated_at before update on public.agents
  for each row execute function public.set_updated_at();

-- ─────────────────────── CRM: empresas y clientes ─────────────────

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sector text,
  city text,
  website text,
  instagram text,
  phone text,
  need_detected text,
  recommended_service text,
  stage public.crm_stage not null default 'prospect',
  is_client boolean not null default false,
  next_action text,
  next_action_at timestamptz,
  notes text,
  -- De dónde sale cada ficha (URL, hoja de prospección, conversación…).
  source text not null,
  is_demo boolean not null default false,
  created_by text not null default 'admin',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index companies_name_city_key on public.companies (lower(name), lower(coalesce(city, '')));
create trigger companies_updated_at before update on public.companies
  for each row execute function public.set_updated_at();

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  role text,
  email text,
  phone text,
  instagram text,
  preferred_channel text,
  -- Base legal para contactar (LSSI/RGPD): p. ej. «dato público de empresa», «consentimiento».
  legal_basis text,
  notes text,
  source text not null,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger contacts_updated_at before update on public.contacts
  for each row execute function public.set_updated_at();

create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  title text not null,
  service text not null,
  value_eur numeric(10, 2) check (value_eur is null or value_eur >= 0),
  stage public.crm_stage not null default 'prospect',
  next_action text,
  next_action_at timestamptz,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger opportunities_updated_at before update on public.opportunities
  for each row execute function public.set_updated_at();

create table public.client_services (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  service text not null,
  price_eur_month numeric(10, 2) check (price_eur_month is null or price_eur_month >= 0),
  status text not null default 'active' check (status in ('active', 'paused', 'cancelled')),
  started_at date,
  ended_at date,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies (id) on delete set null,
  name text not null,
  description text,
  status text not null default 'active' check (status in ('planned', 'active', 'paused', 'done')),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger projects_updated_at before update on public.projects
  for each row execute function public.set_updated_at();

-- ───────────────────────────── Tareas ────────────────────────────

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 1 and 300),
  description text not null default '',
  status public.task_status not null default 'pending',
  priority public.task_priority not null default 'normal',
  agent_id text references public.agents (id) on delete set null,
  -- 'admin' o el id del agente que la creó (p. ej. Alex al delegar).
  created_by text not null default 'admin',
  parent_task_id uuid references public.tasks (id) on delete cascade,
  requires_review boolean not null default false,
  reviewer_agent_id text references public.agents (id) on delete set null,
  review_approved boolean not null default false,
  client_id uuid references public.companies (id) on delete set null,
  project_id uuid references public.projects (id) on delete set null,
  input jsonb not null default '{}',
  result text,
  result_data jsonb,
  error text,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 2 check (max_attempts between 1 and 5),
  due_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tasks_status_idx on public.tasks (status);
create index tasks_agent_idx on public.tasks (agent_id, status);
create index tasks_parent_idx on public.tasks (parent_task_id);
create trigger tasks_updated_at before update on public.tasks
  for each row execute function public.set_updated_at();

alter table public.agents
  add constraint agents_current_task_fk
  foreign key (current_task_id) references public.tasks (id) on delete set null;

create table public.task_events (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.tasks (id) on delete cascade,
  agent_id text references public.agents (id) on delete set null,
  type text not null,
  from_status public.task_status,
  to_status public.task_status,
  message text,
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index task_events_task_idx on public.task_events (task_id, created_at);

-- ──────────────────── Conversaciones y reuniones ─────────────────

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('direct', 'meeting')),
  agent_id text references public.agents (id) on delete cascade,
  title text not null default '',
  participants text[] not null default '{}',
  task_id uuid references public.tasks (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind = 'meeting' or agent_id is not null)
);
create trigger conversations_updated_at before update on public.conversations
  for each row execute function public.set_updated_at();

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  role text not null check (role in ('admin', 'agent', 'system', 'tool')),
  agent_id text references public.agents (id) on delete set null,
  content text not null,
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index messages_conversation_idx on public.messages (conversation_id, created_at);

-- ───────────────────────────── Memoria ───────────────────────────

create table public.memory_items (
  id uuid primary key default gen_random_uuid(),
  scope public.memory_scope not null,
  agent_id text references public.agents (id) on delete cascade,
  client_id uuid references public.companies (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  category text not null check (category in (
    'corporate', 'brand', 'services', 'pricing', 'clients', 'prospects', 'projects',
    'strategy', 'documents', 'decisions', 'results', 'learnings', 'other')),
  title text not null,
  content text not null,
  -- Origen del dato (archivo, URL, tarea, conversación…). Obligatorio.
  source text not null,
  source_ref text,
  created_by text not null default 'admin',
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (scope = 'global'  and agent_id is null and client_id is null and project_id is null) or
    (scope = 'agent'   and agent_id is not null and client_id is null and project_id is null) or
    (scope = 'client'  and client_id is not null and project_id is null) or
    (scope = 'project' and project_id is not null)
  )
);
-- Evita duplicar la misma entrada dentro de un mismo ámbito.
create unique index memory_items_unique_title on public.memory_items (
  scope,
  coalesce(agent_id, ''),
  coalesce(client_id::text, ''),
  coalesce(project_id::text, ''),
  lower(title)
);
create trigger memory_items_updated_at before update on public.memory_items
  for each row execute function public.set_updated_at();

-- ─────────────────────── Aprobaciones humanas ────────────────────

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.tasks (id) on delete cascade,
  agent_id text not null references public.agents (id) on delete cascade,
  tool_id text not null,
  risk text not null,
  summary text not null,
  payload jsonb not null default '{}',
  status public.approval_status not null default 'pending',
  decided_by uuid references auth.users (id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  check ((status = 'pending') = (decided_at is null))
);
create index approvals_status_idx on public.approvals (status, created_at);

-- ───────────────────── Registro y consumo de IA ──────────────────

create table public.activity_log (
  id bigint generated always as identity primary key,
  actor_type text not null check (actor_type in ('admin', 'agent', 'system')),
  actor_id text,
  action text not null,
  entity_type text,
  entity_id text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index activity_log_created_idx on public.activity_log (created_at desc);

create table public.ai_usage (
  id bigint generated always as identity primary key,
  agent_id text references public.agents (id) on delete set null,
  task_id uuid references public.tasks (id) on delete set null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  server_tool_requests integer not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  created_at timestamptz not null default now()
);
create index ai_usage_created_idx on public.ai_usage (created_at);

-- Ajustes no secretos (límites de gasto, notificaciones…). Las claves API
-- viven en variables de entorno del servidor, nunca aquí.
create table public.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
create trigger settings_updated_at before update on public.settings
  for each row execute function public.set_updated_at();

-- ─────────────────────── Row Level Security ──────────────────────

alter table public.admins enable row level security;
alter table public.agents enable row level security;
alter table public.companies enable row level security;
alter table public.contacts enable row level security;
alter table public.opportunities enable row level security;
alter table public.client_services enable row level security;
alter table public.projects enable row level security;
alter table public.tasks enable row level security;
alter table public.task_events enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.memory_items enable row level security;
alter table public.approvals enable row level security;
alter table public.activity_log enable row level security;
alter table public.ai_usage enable row level security;
alter table public.settings enable row level security;

-- Cada administrador puede comprobar su propia fila (la app lo usa al iniciar sesión).
create policy "admins: ver la propia fila" on public.admins
  for select to authenticated using (user_id = (select auth.uid()));

-- Acceso completo para el administrador en las tablas de trabajo.
do $$
declare t text;
begin
  foreach t in array array[
    'agents', 'companies', 'contacts', 'opportunities', 'client_services', 'projects',
    'tasks', 'task_events', 'conversations', 'messages', 'memory_items', 'approvals',
    'ai_usage', 'settings'
  ] loop
    execute format(
      'create policy "admin: acceso completo" on public.%I for all to authenticated
         using ((select public.is_admin())) with check ((select public.is_admin()))', t);
  end loop;
end;
$$;

-- El registro de actividad solo se lee y se añade; nunca se edita ni se borra.
create policy "admin: leer actividad" on public.activity_log
  for select to authenticated using ((select public.is_admin()));
create policy "admin: añadir actividad" on public.activity_log
  for insert to authenticated with check ((select public.is_admin()) and actor_type = 'admin');

revoke update, delete, truncate on public.activity_log from authenticated, anon;

-- ─────────────────────────── Tiempo real ─────────────────────────
-- La oficina 3D escucha estos cambios para mostrar el estado real.

alter publication supabase_realtime add table
  public.agents, public.tasks, public.task_events, public.approvals, public.messages;
