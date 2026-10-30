import { notFound } from "next/navigation";
import { AgentAvatar } from "@/components/agent-avatar";
import { StatusBadge } from "@/components/status-badge";
import { RISK_LABEL, riskRequiresApproval } from "@/lib/agents/permissions";
import { composeSystemPrompt } from "@/lib/agents/prompts";
import { DEPARTMENTS, MODELS } from "@/lib/agents/registry";
import { availabilityLabel, getTool } from "@/lib/agents/tools";
import { requireViewer } from "@/lib/auth/session";
import { getAgentProfile, type TaskSummary } from "@/lib/data/agents";
import { TASK_PRIORITY_LABEL, TASK_STATUS_LABEL } from "@/lib/domain/status";

function TaskList({ tasks, empty }: { tasks: TaskSummary[]; empty: string }) {
  if (tasks.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-line">
      {tasks.map((t) => (
        <li key={t.id} className="flex items-center justify-between gap-3 py-2 text-sm">
          <span className="truncate">{t.title}</span>
          <span className="shrink-0 text-xs text-muted">
            {TASK_STATUS_LABEL[t.status]} · {TASK_PRIORITY_LABEL[t.priority]}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-muted">{title}</h2>
      {children}
    </section>
  );
}

export default async function EmployeePage({ params }: PageProps<"/empleados/[id]">) {
  const { id } = await params;
  const viewer = await requireViewer();
  const profile = await getAgentProfile(viewer, id);
  if (!profile) notFound();
  const { agent, openTasks, completedTasks, history } = profile;
  const dept = DEPARTMENTS[agent.department];

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-5 rounded-2xl border border-line bg-surface p-6 sm:flex-row sm:items-center">
        <AgentAvatar avatar={agent.avatar} size={96} label={`Avatar de ${agent.name}`} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-xs uppercase tracking-[0.18em]" style={{ color: dept.color }}>
            {dept.name}
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold">{agent.name}</h1>
          <p className="text-muted">{agent.role}</p>
          <div className="mt-3">
            <StatusBadge status={agent.state.status} />
            {agent.state.statusDetail && <span className="ml-3 text-xs text-muted">{agent.state.statusDetail}</span>}
          </div>
        </div>
        <div className="flex gap-2 sm:flex-col">
          <button
            disabled
            title="Disponible en la fase 3"
            className="rounded-lg bg-cobalt px-4 py-2 text-sm font-medium text-white opacity-50"
          >
            Conversar
          </button>
          <button
            disabled
            title="Disponible en la fase 3"
            className="rounded-lg border border-line px-4 py-2 text-sm opacity-50"
          >
            Asignar tarea
          </button>
          <span className="hidden text-center text-[11px] text-muted sm:block">Fase 3</span>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Puesto">
            <p>{agent.description}</p>
            <p className="mt-3 text-sm text-muted">
              <span className="text-paper">Especialidad:</span> {agent.specialty}
            </p>
            <p className="mt-1 text-sm text-muted">
              <span className="text-paper">Personalidad:</span> {agent.personality}
            </p>
            <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-paper/85">
              {agent.responsibilities.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </Card>
          <Card title="Tarea actual">
            <p className="text-sm">{agent.state.currentTask?.title ?? <span className="text-muted">Ninguna</span>}</p>
          </Card>
          <Card title={`Tareas pendientes (${openTasks.length})`}>
            <TaskList tasks={openTasks} empty="No tiene tareas pendientes." />
          </Card>
          <Card title={`Tareas completadas (${completedTasks.length})`}>
            <TaskList tasks={completedTasks} empty="Todavía no ha completado tareas." />
          </Card>
          <Card title="Historial">
            {history.length === 0 ? (
              <p className="text-sm text-muted">Sin actividad registrada.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {history.map((e) => (
                  <li key={e.id} className="flex gap-3">
                    <time className="shrink-0 text-xs text-muted" dateTime={e.createdAt}>
                      {new Date(e.createdAt).toLocaleString("es-ES")}
                    </time>
                    <span>{e.message ?? e.type}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Modelo">
            <p className="text-sm">{MODELS[agent.state.model].label}</p>
            <p className="mt-1 text-xs text-muted">Esfuerzo de razonamiento: {agent.effort}</p>
          </Card>
          <Card title="Herramientas">
            <ul className="space-y-3">
              {agent.tools.map((id) => {
                const tool = getTool(id);
                return (
                  <li key={id} className="text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span>{tool.name}</span>
                      {riskRequiresApproval(tool.risk) && (
                        <span className="rounded-full bg-signal/15 px-2 py-0.5 text-[10px] text-signal">
                          Requiere aprobación
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted">
                      {RISK_LABEL[tool.risk]} · {availabilityLabel(tool.availability)}
                    </p>
                  </li>
                );
              })}
            </ul>
          </Card>
          <Card title="Instrucciones de sistema">
            <details>
              <summary className="cursor-pointer text-sm text-cobalt-soft">Ver instrucciones completas</summary>
              <pre className="mt-3 whitespace-pre-wrap font-sans text-xs leading-relaxed text-paper/80">
                {composeSystemPrompt(agent.instructions)}
              </pre>
            </details>
          </Card>
        </div>
      </div>
    </div>
  );
}
