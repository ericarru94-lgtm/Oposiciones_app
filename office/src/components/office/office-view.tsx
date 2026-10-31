"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { Component, useEffect, useMemo, useState, type ReactNode } from "react";
import { AgentAvatar } from "@/components/agent-avatar";
import { StatusBadge } from "@/components/status-badge";
import { DEPARTMENTS, MODELS, type ModelId } from "@/lib/agents/registry";
import { AGENT_STATUSES, AGENT_STATUS_LABEL } from "@/lib/domain/status";
import { chooseView, type ViewMode } from "@/lib/office/scene";
import type { ConnectionState } from "@/lib/office/sync";
import type { OfficeAgentData, OfficeSnapshot } from "./types";
import { useOfficeSync, type RealtimeConfig } from "./use-office-sync";

const Office3D = dynamic(() => import("./office-3d"), {
  ssr: false,
  loading: () => <p className="grid h-full place-items-center text-sm text-muted">Cargando la oficina 3D…</p>,
});

const VIEW_KEY = "office-view";

function readSaved(): ViewMode | null {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === "3d" || v === "list" ? v : null;
  } catch {
    return null;
  }
}

function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}

/** Si la escena falla (contexto WebGL perdido, GPU sin soporte), se vuelve a la lista. */
class SceneBoundary extends Component<{ onFail: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFail();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const CONNECTION: Record<ConnectionState, { label: string; dot: string }> = {
  connecting: { label: "Conectando…", dot: "bg-warn" },
  live: { label: "En directo", dot: "bg-online" },
  reconnecting: { label: "Reconectando…", dot: "bg-warn" },
  offline: { label: "Sin conexión", dot: "bg-danger" },
  disabled: { label: "Sin tiempo real (vista previa local)", dot: "bg-muted" },
};

function ConnectionBadge({ state, syncedAt, onRetry }: { state: ConnectionState; syncedAt: string; onRetry: () => void }) {
  const c = CONNECTION[state];
  const time = new Date(syncedAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return (
    <p className="flex items-center gap-2 text-xs text-muted" role="status" aria-live="polite" data-testid="connection">
      <span className={`size-2 rounded-full ${c.dot}`} />
      <span className="text-paper/90">{c.label}</span>
      <span>· datos de las {time}</span>
      {(state === "offline" || state === "reconnecting") && (
        <button type="button" onClick={onRetry} className="underline hover:text-paper">
          Releer ahora
        </button>
      )}
    </p>
  );
}

function AgentPanel({ agent, onClose }: { agent: OfficeAgentData; onClose: () => void }) {
  const dept = DEPARTMENTS[agent.department];
  const model = Object.hasOwn(MODELS, agent.model) ? MODELS[agent.model as ModelId].label : agent.model;
  return (
    <aside
      className="max-h-[70vh] overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-xl"
      aria-label={`Ficha de ${agent.name}`}
      data-testid="agent-panel"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <AgentAvatar avatar={agent.avatar} label={`Avatar de ${agent.name}`} />
          <div className="min-w-0">
            <p className="font-display text-lg font-semibold">{agent.name}</p>
            <p className="text-sm text-muted">{agent.role}</p>
          </div>
        </div>
        <button type="button" onClick={onClose} className="text-sm text-muted hover:text-paper" aria-label="Cerrar ficha">
          ✕
        </button>
      </div>
      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Estado</dt>
          <dd>{agent.pilot ? <StatusBadge status={agent.status} /> : <span className="text-muted">Inactivo · fuera del piloto</span>}</dd>
        </div>
        {agent.pilot && agent.statusDetail && (
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Detalle</dt>
            <dd className="text-right">{agent.statusDetail}</dd>
          </div>
        )}
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Departamento</dt>
          <dd className="flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: dept.color }} />
            {dept.name}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Modelo</dt>
          <dd>{model}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Tarea actual</dt>
          <dd className="text-right">
            {agent.currentTask ? (
              <Link className="underline hover:text-cobalt-soft" href={`/tareas/${agent.currentTask.id}`}>
                {agent.currentTask.title}
              </Link>
            ) : (
              <span className="text-muted">Ninguna</span>
            )}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Tareas</dt>
          <dd>
            {agent.openTasks} pendientes · {agent.completedTasks} completadas
          </dd>
        </div>
        {agent.statusUpdatedAt && (
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Último cambio</dt>
            <dd>{new Date(agent.statusUpdatedAt).toLocaleString("es-ES")}</dd>
          </div>
        )}
      </dl>
      <Link
        href={`/empleados/${agent.id}`}
        className="mt-4 inline-block rounded-lg border border-line px-3 py-2 text-sm hover:border-cobalt"
      >
        Ver perfil e historial
      </Link>
    </aside>
  );
}

function AgentList({ agents, onSelect }: { agents: OfficeAgentData[]; onSelect: (id: string) => void }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="office-list">
      {agents.map((a) => {
        const dept = DEPARTMENTS[a.department];
        return (
          <li key={a.id} className="min-w-0">
            <button
              type="button"
              onClick={() => onSelect(a.id)}
              className={`group flex h-full w-full flex-col gap-4 rounded-2xl border border-line bg-surface p-5 text-left transition hover:border-cobalt ${
                a.pilot ? "" : "opacity-60"
              }`}
            >
              <div className="flex items-center gap-4">
                <AgentAvatar avatar={a.avatar} label={`Avatar de ${a.name}`} />
                <div className="min-w-0">
                  <p className="font-display text-lg font-semibold">{a.name}</p>
                  <p className="truncate text-sm text-muted">{a.role}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                {a.pilot ? <StatusBadge status={a.status} /> : <span className="text-xs text-muted">Inactivo · fuera del piloto</span>}
                <span className="flex items-center gap-1.5 text-xs text-muted">
                  <span className="size-2 rounded-full" style={{ background: dept.color }} />
                  {dept.name}
                </span>
              </div>
              <p className="text-sm text-paper/80">
                {a.currentTask ? (
                  <>
                    <span className="text-muted">Tarea actual: </span>
                    {a.currentTask.title}
                  </>
                ) : (
                  <span className="text-muted">Sin tarea en curso</span>
                )}
              </p>
              <p className="mt-auto text-xs text-muted">
                {a.openTasks} pendientes · {a.completedTasks} completadas
              </p>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function OfficeView({ initial, realtime }: { initial: OfficeSnapshot; realtime: RealtimeConfig | null }) {
  const { snapshot, connection, resync } = useOfficeSync(initial, realtime);
  const [view, setView] = useState<ViewMode>("list");
  const [webgl, setWebgl] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const gl = hasWebGL();
    const rm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setWebgl(gl);
    setReducedMotion(rm);
    setView(chooseView({ webgl: gl, width: window.innerWidth, reducedMotion: rm, saved: readSaved() }));
  }, []);

  const pick = (v: ViewMode) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // Sin almacenamiento: la preferencia dura hasta recargar.
    }
  };

  // Los agentes fuera del piloto cuentan como inactivos, no por su estado guardado.
  const counts = useMemo(() => {
    const pilot = snapshot.agents.filter((a) => a.pilot);
    return [
      ...AGENT_STATUSES.map((s) => ({ label: AGENT_STATUS_LABEL[s], n: pilot.filter((a) => a.status === s).length })).filter((c) => c.n > 0),
      { label: "Inactivos", n: snapshot.agents.length - pilot.length },
    ];
  }, [snapshot.agents]);
  const selected = snapshot.agents.find((a) => a.id === selectedId) ?? null;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-cobalt-soft">Oficina</p>
          <h1 className="mt-2 font-display text-3xl font-semibold">Tu equipo</h1>
          <p className="mt-2 text-sm text-muted">
            {snapshot.agents.length} empleados de IA. En el piloto trabajan Alex, Marcus y Sofia; el resto aparece inactivo.
          </p>
          <div className="mt-2">
            <ConnectionBadge state={connection} syncedAt={snapshot.syncedAt} onRetry={resync} />
          </div>
        </div>
        <div className="flex flex-col items-start gap-3 sm:items-end">
          <div className="inline-flex rounded-lg border border-line p-0.5 text-sm" role="group" aria-label="Tipo de vista">
            {(["3d", "list"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => pick(v)}
                disabled={v === "3d" && !webgl}
                aria-pressed={view === v}
                title={v === "3d" && !webgl ? "Este navegador no tiene WebGL" : undefined}
                className={`rounded-md px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-40 ${
                  view === v ? "bg-cobalt text-white" : "text-muted hover:text-paper"
                }`}
              >
                {v === "3d" ? "3D" : "Lista"}
              </button>
            ))}
          </div>
          <dl className="flex flex-wrap gap-2 text-xs sm:justify-end">
            {counts.map(({ label, n }) => (
              <div key={label} className="rounded-full border border-line px-3 py-1">
                <dt className="inline text-muted">{label}: </dt>
                <dd className="inline font-medium">{n}</dd>
              </div>
            ))}
            {snapshot.pendingApprovals > 0 && (
              <div className="rounded-full border border-signal/50 px-3 py-1 text-signal">
                <Link href="/centro">Aprobaciones pendientes: {snapshot.pendingApprovals}</Link>
              </div>
            )}
          </dl>
        </div>
      </div>

      <div className="relative mt-8">
        {view === "3d" ? (
          <div className="h-[60vh] min-h-[420px] overflow-hidden rounded-2xl border border-line bg-ink">
            <SceneBoundary onFail={() => setView("list")}>
              <Office3D agents={snapshot.agents} selectedId={selectedId} onSelect={setSelectedId} reducedMotion={reducedMotion} />
            </SceneBoundary>
          </div>
        ) : (
          <AgentList agents={snapshot.agents} onSelect={setSelectedId} />
        )}
        {selected && (
          <div className={view === "3d" ? "relative z-30 mt-4 lg:absolute lg:right-4 lg:top-4 lg:mt-0 lg:w-80" : "fixed inset-x-4 bottom-24 z-30 lg:bottom-6 lg:left-auto lg:right-6 lg:w-80"}>
            <AgentPanel agent={selected} onClose={() => setSelectedId(null)} />
          </div>
        )}
      </div>
    </div>
  );
}
