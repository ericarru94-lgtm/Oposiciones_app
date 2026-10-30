import Link from "next/link";
import { AgentAvatar } from "@/components/agent-avatar";
import { StatusBadge } from "@/components/status-badge";
import { DEPARTMENTS } from "@/lib/agents/registry";
import { requireViewer } from "@/lib/auth/session";
import { listAgents } from "@/lib/data/agents";
import { AGENT_STATUSES, AGENT_STATUS_LABEL } from "@/lib/domain/status";

export default async function OfficePage() {
  const viewer = await requireViewer();
  const agents = await listAgents(viewer);
  const counts = AGENT_STATUSES.map((s) => ({ s, n: agents.filter((a) => a.state.status === s).length }));

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-cobalt-soft">Oficina</p>
          <h1 className="mt-2 font-display text-3xl font-semibold">Tu equipo</h1>
          <p className="mt-2 text-sm text-muted">
            {agents.length} empleados de IA. La vista 3D de la oficina llega en la fase 2; esta vista en lista se
            mantiene para móvil y equipos menos potentes.
          </p>
        </div>
        <dl className="flex flex-wrap gap-2 text-xs">
          {counts.map(({ s, n }) => (
            <div key={s} className="rounded-full border border-line px-3 py-1">
              <dt className="inline text-muted">{AGENT_STATUS_LABEL[s]}: </dt>
              <dd className="inline font-medium">{n}</dd>
            </div>
          ))}
        </dl>
      </div>

      <ul className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {agents.map((a) => {
          const dept = DEPARTMENTS[a.department];
          return (
            <li key={a.id} className="min-w-0">
              <Link
                href={`/empleados/${a.id}`}
                className="group flex h-full flex-col gap-4 rounded-2xl border border-line bg-surface p-5 transition hover:border-cobalt"
              >
                <div className="flex items-center gap-4">
                  <AgentAvatar avatar={a.avatar} label={`Avatar de ${a.name}`} />
                  <div className="min-w-0">
                    <p className="font-display text-lg font-semibold">{a.name}</p>
                    <p className="truncate text-sm text-muted">{a.role}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <StatusBadge status={a.state.status} />
                  <span className="flex items-center gap-1.5 text-xs text-muted">
                    <span className="size-2 rounded-full" style={{ background: dept.color }} />
                    {dept.name}
                  </span>
                </div>
                <p className="text-sm text-paper/80">
                  {a.state.currentTask ? (
                    <>
                      <span className="text-muted">Tarea actual: </span>
                      {a.state.currentTask.title}
                    </>
                  ) : (
                    <span className="text-muted">Sin tarea en curso</span>
                  )}
                </p>
                <p className="mt-auto text-xs text-muted">
                  {a.state.openTasks} pendientes · {a.state.completedTasks} completadas
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
