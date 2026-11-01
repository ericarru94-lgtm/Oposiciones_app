import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { getAgent } from "@/lib/agents/registry";
import { requireViewer } from "@/lib/auth/session";
import { getBudgetStatus } from "@/lib/data/budget";
import { getDashboard } from "@/lib/data/dashboard";
import { getOfficeSnapshot } from "@/lib/data/office";
import { TASK_STATUS_LABEL } from "@/lib/domain/status";

const usd = (n: number) => `${n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} $`;
const when = (iso: string) => new Date(iso).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

const OUTCOME_STYLE: Record<string, string> = {
  completed: "text-online",
  completed_with_warnings: "text-warn",
  partially_completed: "text-warn",
  failed: "text-danger",
};

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="rounded-2xl bg-surface/80 ring-1 ring-white/5 p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 font-display text-2xl font-semibold ${tone ?? ""}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export default async function Page() {
  const viewer = await requireViewer();
  const [office, data, budget] = await Promise.all([getOfficeSnapshot(viewer), getDashboard(viewer), getBudgetStatus(viewer)]);
  const pilot = office.agents.filter((a) => a.pilot);

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs uppercase tracking-[0.18em] text-cobalt-soft">Centro de mando</p>
        <h1 className="mt-2 font-display text-3xl font-semibold">Estado de la oficina</h1>
        <p className="mt-2 text-sm text-muted">Datos reales de Supabase en el momento de cargar la página. Esta pantalla solo lee: no ejecuta nada.</p>
      </div>

      {!data ? (
        <p className="rounded-2xl bg-surface/80 ring-1 ring-white/5 p-5 text-sm text-muted">
          Vista previa local: sin base de datos no hay encargos, costes ni actividad que mostrar.
        </p>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Resumen">
            <Stat
              label="Gasto de IA este mes"
              value={budget ? usd(budget.monthSpentUsd) : "—"}
              hint={budget?.monthlyLimitUsd != null ? `de ${usd(budget.monthlyLimitUsd)} · límite por encargo ${usd(budget.missionLimitUsd ?? 0)}` : undefined}
              tone={budget?.exceeded ? "text-danger" : undefined}
            />
            <Stat label="Encargos en marcha" value={String(data.running)} />
            <Stat label="Aprobaciones pendientes" value={String(data.approvals.length)} tone={data.approvals.length ? "text-signal" : undefined} />
            <Stat label="Encargos fallidos (30 días)" value={String(data.failed30d)} tone={data.failed30d ? "text-danger" : undefined} />
            <Stat label="Fichas en el CRM" value={String(data.companies)} />
            <Stat label="Documentos" value={String(data.documents)} />
            <Stat label="Agentes en el piloto" value={`${pilot.length} de ${office.agents.length}`} hint="El resto está inactivo" />
          </section>

          <section aria-labelledby="equipo">
            <h2 id="equipo" className="font-display text-lg font-semibold">Equipo del piloto</h2>
            <ul className="mt-3 grid gap-3 sm:grid-cols-3">
              {pilot.map((a) => (
                <li key={a.id} className="rounded-2xl bg-surface/80 ring-1 ring-white/5 p-4">
                  <Link href={`/empleados/${a.id}`} className="font-medium hover:text-cobalt-soft">{a.name}</Link>
                  <div className="mt-1"><StatusBadge status={a.status} /></div>
                  <p className="mt-2 truncate text-xs text-muted">{a.currentTask ? `Tarea: ${a.currentTask.title}` : "Sin tarea en curso"}</p>
                </li>
              ))}
            </ul>
          </section>

          {data.approvals.length > 0 && (
            <section aria-labelledby="aprobaciones">
              <h2 id="aprobaciones" className="font-display text-lg font-semibold">Aprobaciones pendientes</h2>
              <ul className="mt-3 space-y-2">
                {data.approvals.map((a) => (
                  <li key={a.id} className="rounded-xl border border-signal/40 bg-signal/5 p-3 text-sm">
                    <span className="font-medium">{getAgent(a.agentId)?.name ?? a.agentId}</span> · riesgo {a.risk} · {a.summary}
                    {a.taskId && <Link className="ml-2 underline" href={`/tareas/${a.taskId}`}>Abrir encargo</Link>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="encargos">
            <h2 id="encargos" className="font-display text-lg font-semibold">Últimos encargos</h2>
            {data.missions.length === 0 ? (
              <p className="mt-3 text-sm text-muted">Todavía no hay encargos.</p>
            ) : (
              <div className="mt-3 overflow-x-auto rounded-2xl bg-surface/60 ring-1 ring-white/5">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead className="text-xs text-muted">
                    <tr><th className="p-3">Encargo</th><th className="p-3">Resultado</th><th className="p-3">Coste</th><th className="p-3">Fecha</th></tr>
                  </thead>
                  <tbody>
                    {data.missions.map((m) => (
                      <tr key={m.id} className="border-t border-white/5 transition hover:bg-white/[0.03]">
                        <td className="p-3"><Link className="hover:text-cobalt-soft" href={`/tareas/${m.id}`}>{m.title}</Link></td>
                        <td className={`p-3 ${m.outcome ? OUTCOME_STYLE[m.outcome] : "text-muted"}`}>
                          {m.outcomeLabel ?? TASK_STATUS_LABEL[m.status]}
                          {m.warnings > 0 && <span className="ml-1 text-xs text-warn">({m.warnings} avisos)</span>}
                        </td>
                        <td className="p-3 tabular-nums">{usd(m.costUsd)}</td>
                        <td className="p-3 text-muted">{when(m.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section aria-labelledby="actividad">
            <h2 id="actividad" className="font-display text-lg font-semibold">Actividad reciente</h2>
            <ol className="mt-3 space-y-1.5 text-sm">
              {data.events.map((e) => (
                <li key={e.id} className="flex gap-3">
                  <span className="w-24 shrink-0 text-xs text-muted">{when(e.createdAt)}</span>
                  <span className="min-w-0 truncate">
                    <span className="text-muted">{e.agentId ? `${getAgent(e.agentId)?.name ?? e.agentId} · ` : ""}{e.type}</span>
                    {e.message ? ` · ${e.message}` : ""}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </div>
  );
}
