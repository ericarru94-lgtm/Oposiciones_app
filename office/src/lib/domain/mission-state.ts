// Estado visible de una misión, calculado SOLO con lo que hay en la base de
// datos (estado de cada tarea, lease y hora de reintento). El navegador no
// guarda nada: si se cierra, al volver se calcula igual.

export interface MissionTaskState {
  status: string;
  lockedUntil: string | null;
  runAfter: string | null;
  heartbeatAt: string | null;
  error: string | null;
}

export type MissionPhase =
  | { kind: "completed" }
  | { kind: "stopped"; reason: string | null }
  | { kind: "working"; lastActivity: string | null }
  | { kind: "retry"; at: string }
  | { kind: "ready" } //  hay trabajo listo: se reanuda con la página abierta
  | { kind: "waiting" };

const OPEN = new Set(["pending", "assigned", "in_progress"]);

export function missionPhase(mission: MissionTaskState, children: MissionTaskState[], now = new Date()): MissionPhase {
  if (mission.status === "completed") return { kind: "completed" };
  if (mission.status === "failed") return { kind: "stopped", reason: mission.error };
  const all = [mission, ...children];
  const t = now.getTime();
  const working = all.filter((x) => x.lockedUntil && Date.parse(x.lockedUntil) > t);
  if (working.length > 0) {
    const last = working.map((x) => x.heartbeatAt).filter(Boolean).sort().at(-1) ?? null;
    return { kind: "working", lastActivity: last };
  }
  const open = all.filter((x) => OPEN.has(x.status));
  const openChildren = children.filter((x) => OPEN.has(x.status));
  // El encargo principal espera mientras alguna subtarea siga abierta.
  const candidates = openChildren.length > 0 ? openChildren : open;
  const due = candidates.filter((x) => !x.runAfter || Date.parse(x.runAfter) <= t);
  if (due.length > 0) return { kind: "ready" };
  const retries = candidates.map((x) => x.runAfter).filter((x): x is string => !!x && Date.parse(x) > t).sort();
  if (retries.length > 0) return { kind: "retry", at: retries[0] };
  return { kind: "waiting" };
}
