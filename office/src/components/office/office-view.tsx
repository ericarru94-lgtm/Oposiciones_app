"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { agentDetail } from "@/app/actions/office";
import { AgentAvatar } from "@/components/agent-avatar";
import { StatusBadge } from "@/components/status-badge";
import { DEPARTMENTS, MODELS, type ModelId } from "@/lib/agents/catalog";
import { AGENT_STATUSES, AGENT_STATUS_LABEL, TASK_STATUS_LABEL, type TaskStatus } from "@/lib/domain/status";
import { QUICK_FOCUS, stationOf } from "@/lib/office/layout";
import { chooseView, type ViewMode } from "@/lib/office/scene";
import type { ConnectionState } from "@/lib/office/sync";
import type { CameraMode } from "./office-3d";
import type { AgentDetail, OfficeAgentData, OfficeSnapshot } from "./types";
import { useOfficeSync, type RealtimeConfig } from "./use-office-sync";

const Office3D = dynamic(() => import("./office-3d"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center">
      <p className="flex items-center gap-3 text-sm text-muted">
        <span className="size-2 animate-pulse rounded-full bg-cobalt-soft" />
        Preparando la oficina 3D…
      </p>
    </div>
  ),
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

const CONNECTION: Record<ConnectionState, { label: string; dot: string; ring: string }> = {
  connecting: { label: "Conectando…", dot: "bg-warn", ring: "ring-warn/30" },
  live: { label: "En directo", dot: "bg-online", ring: "ring-online/30" },
  reconnecting: { label: "Reconectando…", dot: "bg-warn", ring: "ring-warn/30" },
  offline: { label: "Sin conexión", dot: "bg-danger", ring: "ring-danger/40" },
  disabled: { label: "Sin tiempo real · vista previa local", dot: "bg-muted", ring: "ring-white/10" },
};

const time = (iso: string) => new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
const when = (iso: string) => new Date(iso).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

function ConnectionBadge({ state, syncedAt, onRetry }: { state: ConnectionState; syncedAt: string; onRetry: () => void }) {
  const c = CONNECTION[state];
  return (
    <p className={`inline-flex items-center gap-2 rounded-full bg-white/[0.03] px-3 py-1.5 text-xs text-muted ring-1 ${c.ring}`} role="status" aria-live="polite" data-testid="connection">
      <span className="relative flex size-2">
        {state === "live" && <span className="pulse-ring absolute inline-flex size-full rounded-full bg-online" />}
        <span className={`relative inline-flex size-2 rounded-full ${c.dot}`} />
      </span>
      <span className="text-paper/90">{c.label}</span>
      <span className="hidden sm:inline">· datos de las {time(syncedAt)}</span>
      {(state === "offline" || state === "reconnecting") && (
        <button type="button" onClick={onRetry} className="font-medium text-paper underline-offset-2 hover:underline">
          Releer
        </button>
      )}
    </p>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">{title}</h3>
      {children}
    </section>
  );
}

function AgentPanel({ agent, onClose, live }: { agent: OfficeAgentData; onClose: () => void; live: boolean }) {
  const dept = DEPARTMENTS[agent.department];
  const model = Object.hasOwn(MODELS, agent.model) ? MODELS[agent.model as ModelId].label : agent.model;
  const [detail, setDetail] = useState<AgentDetail | null | "loading">("loading");

  // Tareas y actividad reales del agente (lectura con la sesión; en la vista previa local no hay datos).
  useEffect(() => {
    let alive = true;
    setDetail("loading");
    if (!live) {
      setDetail(null);
      return;
    }
    agentDetail(agent.id).then((d) => alive && setDetail(d)).catch(() => alive && setDetail(null));
    return () => {
      alive = false;
    };
  }, [agent.id, agent.statusUpdatedAt, live]);

  return (
    <aside
      className="flex max-h-[inherit] flex-col overflow-hidden rounded-3xl bg-surface shadow-2xl shadow-black/60 ring-1 ring-white/10"
      aria-label={`Ficha de ${agent.name}`}
      data-testid="agent-panel"
    >
      <div className="h-1 shrink-0" style={{ background: `linear-gradient(90deg, ${dept.color}, transparent)` }} />
      <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-white/15 lg:hidden" aria-hidden />
      <header className="flex items-start gap-4 px-5 pb-4 pt-4">
        <div className="shrink-0 rounded-2xl p-0.5" style={{ background: `${dept.color}33` }}>
          <AgentAvatar avatar={agent.avatar} label={`Avatar de ${agent.name}`} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-xl font-semibold leading-tight">{agent.name}</p>
          <p className="text-sm text-paper/70">{agent.role}</p>
          <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-muted">
            <span className="size-2 rounded-full" style={{ background: dept.color }} />
            {dept.name}
          </p>
        </div>
        <button type="button" onClick={onClose} className="grid size-8 place-items-center rounded-full text-muted transition hover:bg-white/5 hover:text-paper" aria-label="Cerrar ficha">
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </header>

      <div className="space-y-5 overflow-y-auto px-5 pb-5">
        <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-white/[0.03] p-3 ring-1 ring-white/5">
          {agent.pilot ? <StatusBadge status={agent.status} /> : <span className="text-xs font-medium text-muted">Inactivo · fuera del piloto</span>}
          <span className="ml-auto rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-muted">{agent.pilot ? "En el piloto" : "Sin ejecutar"}</span>
          {agent.pilot && agent.statusDetail && <p className="w-full text-xs text-paper/70">{agent.statusDetail}</p>}
          {agent.statusUpdatedAt && <p className="w-full text-[11px] text-muted">Último cambio: {when(agent.statusUpdatedAt)}</p>}
        </div>

        <Section title="Función">
          <p className="text-sm leading-relaxed text-paper/85">{agent.description}</p>
          <ul className="space-y-1.5">
            {agent.responsibilities.slice(0, 4).map((r) => (
              <li key={r} className="flex gap-2 text-sm text-paper/70">
                <span className="mt-2 size-1 shrink-0 rounded-full" style={{ background: dept.color }} />
                {r}
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Trabajo">
          <dl className="grid grid-cols-3 gap-2 text-center">
            {[
              ["Pendientes", agent.openTasks],
              ["Completadas", agent.completedTasks],
              ["Modelo", model.replace("Claude ", "")],
            ].map(([k, v]) => (
              <div key={k as string} className="rounded-xl bg-white/[0.03] px-2 py-2 ring-1 ring-white/5">
                <dt className="text-[10px] uppercase tracking-wider text-muted">{k}</dt>
                <dd className="mt-0.5 truncate text-sm font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
          {agent.currentTask ? (
            <Link href={`/tareas/${agent.currentTask.id}`} className="block rounded-xl bg-cobalt/10 px-3 py-2 text-sm ring-1 ring-cobalt/30 transition hover:bg-cobalt/20">
              <span className="text-[11px] uppercase tracking-wider text-cobalt-soft">Tarea actual</span>
              <span className="block truncate">{agent.currentTask.title}</span>
            </Link>
          ) : (
            <p className="text-sm text-muted">Sin tarea en curso.</p>
          )}
          {detail !== "loading" && detail && detail.openTasks.length > 0 && (
            <ul className="space-y-1">
              {detail.openTasks.map((t) => (
                <li key={t.id}>
                  <Link href={`/tareas/${t.id}`} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-white/5">
                    <span className="truncate">{t.title}</span>
                    <span className="shrink-0 text-[11px] text-muted">{TASK_STATUS_LABEL[t.status as TaskStatus] ?? t.status}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Actividad reciente">
          {detail === "loading" ? (
            <div className="space-y-2" aria-hidden>
              {[0, 1, 2].map((i) => <div key={i} className="h-4 animate-pulse rounded bg-white/5" style={{ width: `${85 - i * 15}%` }} />)}
            </div>
          ) : detail && detail.recent.length > 0 ? (
            <ol className="relative space-y-3 border-l border-white/10 pl-4">
              {detail.recent.map((e) => (
                <li key={e.id} className="text-sm">
                  <span className="absolute -left-[3px] mt-1.5 size-1.5 rounded-full bg-cobalt-soft" />
                  <p className="text-paper/85">{e.message ?? e.type}</p>
                  <p className="text-[11px] text-muted">{when(e.createdAt)}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted">{live ? "Sin actividad registrada todavía." : "Sin datos en la vista previa local."}</p>
          )}
        </Section>

        <Link href={`/empleados/${agent.id}`} className="flex items-center justify-center gap-2 rounded-xl bg-white/5 px-3 py-2.5 text-sm font-medium ring-1 ring-white/10 transition hover:bg-white/10">
          Ver perfil e historial completo
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        </Link>
      </div>
    </aside>
  );
}

function AgentList({ agents, selectedId, onSelect }: { agents: OfficeAgentData[]; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="office-list">
      {agents.map((a) => {
        const dept = DEPARTMENTS[a.department];
        return (
          <li key={a.id} className="min-w-0">
            <button
              type="button"
              onClick={() => onSelect(a.id)}
              aria-pressed={selectedId === a.id}
              className={`group relative flex h-full w-full flex-col gap-3 overflow-hidden rounded-2xl bg-surface/80 p-4 text-left ring-1 transition hover:bg-panel ${
                selectedId === a.id ? "ring-cobalt-soft" : "ring-white/5 hover:ring-white/15"
              } ${a.pilot ? "" : "opacity-70"}`}
            >
              <span className="absolute inset-y-0 left-0 w-0.5" style={{ background: a.pilot ? dept.color : "transparent" }} />
              <div className="flex items-center gap-3">
                <AgentAvatar avatar={a.avatar} label={`Avatar de ${a.name}`} />
                <div className="min-w-0 flex-1">
                  <p className="font-display text-base font-semibold">{a.name}</p>
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
              <p className="truncate text-sm text-paper/75">
                {a.currentTask ? <><span className="text-muted">Tarea: </span>{a.currentTask.title}</> : <span className="text-muted">Sin tarea en curso</span>}
              </p>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

const ICON_3D = <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" /></svg>;
const ICON_LIST = <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" /></svg>;

export function OfficeView({ initial, realtime }: { initial: OfficeSnapshot; realtime: RealtimeConfig | null }) {
  const { snapshot, connection, resync } = useOfficeSync(initial, realtime);
  const [view, setView] = useState<ViewMode>("list");
  const [webgl, setWebgl] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [compact, setCompact] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [camMode, setCamMode] = useState<CameraMode>("home");
  const stage = useRef<HTMLDivElement>(null);

  // Móvil: la ficha ocupa la mitad inferior, así que la escena sube para seguir viéndose el puesto.
  useEffect(() => {
    if (compact && view === "3d" && selectedId) stage.current?.scrollIntoView({ block: "start", behavior: reducedMotion ? "auto" : "smooth" });
  }, [compact, view, selectedId, reducedMotion]);

  // WebGL, ancho y «reducir movimiento» solo se conocen en el navegador (tras hidratar).
  useEffect(() => {
    const gl = hasWebGL();
    const rm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setWebgl(gl);
    setCompact(window.innerWidth < 768);
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
  const stats = useMemo(() => {
    const pilot = snapshot.agents.filter((a) => a.pilot);
    const busy = pilot.filter((a) => !["available", "completed", "waiting_agent"].includes(a.status)).length;
    return {
      pilot: pilot.length,
      busy,
      counts: AGENT_STATUSES.map((s) => ({ label: AGENT_STATUS_LABEL[s], n: pilot.filter((a) => a.status === s).length })).filter((c) => c.n > 0),
      inactive: snapshot.agents.length - pilot.length,
    };
  }, [snapshot.agents]);
  const selected = snapshot.agents.find((a) => a.id === selectedId) ?? null;
  const live = realtime !== null;

  return (
    // En móvil, con la ficha abierta, se deja hueco debajo para poder subir la escena por encima de ella.
    <div className={`space-y-4 sm:space-y-5 ${selected && compact ? "pb-[50dvh] lg:pb-0" : ""}`}>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="hidden text-xs font-medium uppercase tracking-[0.2em] text-cobalt-soft sm:block">HE Signal · Oficina</p>
          <h1 className="font-display text-2xl font-semibold tracking-tight sm:mt-1.5 sm:text-4xl">Tu equipo de IA</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 sm:mt-3">
            <ConnectionBadge state={connection} syncedAt={snapshot.syncedAt} onRetry={resync} />
            {snapshot.pendingApprovals > 0 && (
              <Link href="/centro" className="inline-flex items-center gap-2 rounded-full bg-signal/10 px-3 py-1.5 text-xs font-medium text-signal ring-1 ring-signal/40">
                {snapshot.pendingApprovals} aprobación{snapshot.pendingApprovals === 1 ? "" : "es"} pendiente{snapshot.pendingApprovals === 1 ? "" : "s"}
              </Link>
            )}
          </div>
        </div>
        <dl className="grid w-full grid-cols-3 gap-2 sm:w-auto">
          {[
            ["En el piloto", `${stats.pilot}`, "Alex, Marcus y Sofia"],
            ["Trabajando ahora", `${stats.busy}`, stats.counts.map((c) => `${c.label} ${c.n}`).join(" · ") || "—"],
            ["Inactivos", `${stats.inactive}`, "Fuera del piloto"],
          ].map(([k, v, hint]) => (
            <div key={k} className="rounded-2xl bg-surface/80 px-3 py-2 ring-1 ring-white/5 sm:px-4 sm:py-3" title={hint}>
              <dt className="truncate text-[11px] text-muted">{k}</dt>
              <dd className="font-display text-xl font-semibold leading-tight sm:text-2xl">{v}</dd>
            </div>
          ))}
        </dl>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-xl bg-surface p-1 ring-1 ring-white/5" role="group" aria-label="Tipo de vista">
          {(["3d", "list"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => pick(v)}
              disabled={v === "3d" && !webgl}
              aria-pressed={view === v}
              title={v === "3d" && !webgl ? "Este navegador no tiene WebGL" : undefined}
              className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${
                view === v ? "bg-cobalt text-white shadow-lg shadow-cobalt/30" : "text-muted hover:text-paper"
              }`}
            >
              {v === "3d" ? ICON_3D : ICON_LIST}
              {v === "3d" ? "3D" : "Lista"}
            </button>
          ))}
        </div>
        {view === "3d" && (
          <div className="inline-flex rounded-xl bg-surface p-1 ring-1 ring-white/5" role="group" aria-label="Encuadre de la cámara">
            {([["home", "Vista cercana"], ["overview", "Vista general"]] as const).map(([m, label]) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setSelectedId(null);
                  setCamMode(m);
                }}
                aria-pressed={!selected && camMode === m}
                className={`rounded-lg px-3 py-1.5 text-sm transition ${!selected && camMode === m ? "bg-white/10 text-paper" : "text-muted hover:text-paper"}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {view === "3d" && (
        <nav aria-label="Ir a un departamento" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
          {QUICK_FOCUS.map((id) => {
            const agent = snapshot.agents.find((a) => a.id === id);
            const station = stationOf(id);
            if (!agent || !station) return null;
            const on = selectedId === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setSelectedId(on ? null : id)}
                aria-pressed={on}
                data-testid={`focus-${id}`}
                className={`inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-xs ring-1 transition ${
                  on ? "bg-cobalt text-white ring-cobalt" : "bg-surface text-muted ring-white/5 hover:text-paper"
                }`}
              >
                <span className={`size-1.5 rounded-full ${agent.pilot ? "bg-emerald-400" : "bg-white/25"}`} aria-hidden />
                <span className="font-medium text-paper/90">{agent.name}</span>
                <span className="hidden sm:inline">· {station.zone.label}</span>
              </button>
            );
          })}
        </nav>
      )}

      <div className="relative">
        {view === "3d" ? (
          <div ref={stage} className="relative scroll-mt-3 aspect-[6/5] max-h-[70dvh] min-h-[300px] w-full overflow-hidden rounded-3xl bg-ink ring-1 ring-white/5 sm:aspect-[16/10] lg:aspect-auto lg:h-[max(480px,calc(100dvh-330px))]">
            <SceneBoundary onFail={() => setView("list")}>
              <Office3D agents={snapshot.agents} selectedId={selectedId} onSelect={setSelectedId} reducedMotion={reducedMotion} compact={compact} mode={camMode} />
            </SceneBoundary>
            <p className="pointer-events-none absolute bottom-3 left-4 hidden text-[11px] text-paper/40 sm:block">
              Arrastra para girar · rueda o pellizco para acercar · toca un empleado para ver su ficha
            </p>
          </div>
        ) : (
          <AgentList agents={snapshot.agents} selectedId={selectedId} onSelect={setSelectedId} />
        )}
        {selected && (
          <div
            className={
              view === "3d"
                ? "fixed inset-x-3 bottom-[4.75rem] z-30 max-h-[52dvh] lg:absolute lg:inset-x-auto lg:bottom-auto lg:right-4 lg:top-4 lg:max-h-[calc(100%-2rem)] lg:w-[23rem]"
                : "fixed inset-x-3 bottom-[4.75rem] z-30 max-h-[60dvh] lg:bottom-6 lg:left-auto lg:right-6 lg:w-[23rem] lg:max-h-[80vh]"
            }
          >
            <AgentPanel agent={selected} onClose={() => setSelectedId(null)} live={live} />
          </div>
        )}
      </div>
    </div>
  );
}
