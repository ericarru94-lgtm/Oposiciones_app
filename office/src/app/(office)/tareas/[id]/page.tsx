import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusBadge } from "@/components/status-badge";
import { getAgent } from "@/lib/agents/registry";
import { requireViewer } from "@/lib/auth/session";
import { getMission, type MissionTask } from "@/lib/data/missions";
import { OFFICE_EVENT_LABEL, toOfficeEvent } from "@/lib/domain/events";
import { TASK_STATUS_LABEL, agentStatusForTask } from "@/lib/domain/status";
import { EngineRunner } from "./engine-runner";

const usd = (v: number) => `${v.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} $`;
const n = (v: number) => v.toLocaleString("es-ES");
const name = (id: string | null) => (id ? (getAgent(id)?.name ?? id) : "—");
const OPEN = new Set(["pending", "assigned", "in_progress"]);

function TaskCard({ t }: { t: MissionTask }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-ink p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">{name(t.agentId)}</p>
        <StatusBadge status={agentStatusForTask(t.status)} />
      </div>
      <p className="mt-1 text-sm">{t.title}</p>
      <p className="mt-1 text-xs text-muted">
        {TASK_STATUS_LABEL[t.status]} · {usd(t.costUsd)} · {t.modelCalls} llamadas{t.searches ? ` · ${t.searches} búsquedas` : ""}
      </p>
      {t.error && <p className="mt-2 text-xs text-signal">{t.error}</p>}
    </div>
  );
}

export default async function MissionPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireViewer();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const detail = await getMission(viewer, id);
  if (!detail) notFound();
  const { mission, children, events, documents, companies, totals } = detail;
  const active = [mission, ...children].some((t) => OPEN.has(t.status));
  const finalReport = documents.find((d) => d.taskId === mission.id && d.kind === "report");

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Link href="/tareas" className="text-xs text-cobalt-soft hover:underline">← Encargos</Link>
        <h1 className="font-display text-2xl font-semibold">{mission.title}</h1>
        <p className="text-sm text-muted">
          {TASK_STATUS_LABEL[mission.status]}
          {mission.phase === "synthesis" && mission.status !== "completed" ? " · Alex revisa las entregas" : ""}
        </p>
        <EngineRunner active={active} />
      </div>

      <section className="grid gap-3 sm:grid-cols-3">
        <TaskCard t={mission} />
        {children.map((c) => <TaskCard key={c.id} t={c} />)}
      </section>

      <section className="rounded-2xl border border-line bg-surface p-5">
        <h2 className="font-display font-semibold">Coste real</h2>
        <p className="mt-2 text-sm">{usd(totals.costUsd)} en {totals.calls} llamadas a Claude</p>
        <p className="mt-1 text-xs text-muted">
          Tokens: {n(totals.inputTokens)} de entrada · {n(totals.outputTokens)} de salida · {n(totals.cacheReadTokens)} leídos de caché ·{" "}
          {n(totals.cacheWriteTokens)} escritos en caché · {totals.searches} búsquedas web (0,01 $ cada una, incluidas)
        </p>
      </section>

      {finalReport && (
        <section className="rounded-2xl border border-cobalt/40 bg-surface p-5">
          <h2 className="font-display font-semibold">Informe final de Alex (borrador)</h2>
          <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">{finalReport.content}</pre>
        </section>
      )}

      <section className="rounded-2xl border border-line bg-surface p-5">
        <h2 className="font-display font-semibold">Documentos ({documents.length})</h2>
        <div className="mt-3 space-y-2">
          {documents.length === 0 && <p className="text-sm text-muted">Aún no hay documentos.</p>}
          {documents.map((d) => (
            <details key={d.id} className="rounded-lg border border-line bg-ink p-3">
              <summary className="cursor-pointer text-sm">
                {d.title} <span className="text-xs text-muted">· {name(d.agentId)} · {d.kind} · borrador</span>
              </summary>
              <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">{d.content}</pre>
            </details>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-5">
        <h2 className="font-display font-semibold">Fichas del CRM creadas ({companies.length})</h2>
        <ul className="mt-3 divide-y divide-line text-sm">
          {companies.length === 0 && <li className="py-2 text-muted">Ninguna todavía.</li>}
          {companies.map((c) => (
            <li key={c.id} className="space-y-1 py-3">
              <p className="font-medium">{c.name} <span className="text-xs text-muted">· {c.city ?? "sin ciudad"}</span></p>
              {c.needDetected && <p className="text-xs">{c.needDetected}</p>}
              <p className="break-all text-xs text-muted">Fuentes: {c.source}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-5">
        <h2 className="font-display font-semibold">Actividad</h2>
        <ol className="mt-3 space-y-2 text-xs">
          {events.map((e) => {
            const ev = toOfficeEvent(e.type, e.toStatus);
            return (
              <li key={e.id} className="flex flex-wrap gap-x-2">
                <span className="text-muted">{new Date(e.createdAt).toLocaleTimeString("es-ES", { timeZone: "Europe/Madrid" })}</span>
                <span className="font-medium">{name(e.agentId)}</span>
                <span>{ev ? OFFICE_EVENT_LABEL[ev] : e.type}</span>
                {e.message && <span className="min-w-0 break-words text-muted">· {e.message}</span>}
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
