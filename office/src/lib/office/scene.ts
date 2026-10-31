// Qué dibuja la oficina para cada estado real de un agente. Sin aleatoriedad:
// la escena es una función del estado de Supabase. Los agentes fuera del
// piloto se muestran inactivos aunque su fila diga otra cosa.

import { PILOT_AGENT_IDS } from "../agents/registry";
import type { AgentStatus } from "../domain/status";

export type Pose = "idle" | "typing" | "thinking" | "reading" | "waiting" | "alert" | "done" | "off";
export type Screen = "off" | "idle" | "active" | "warning" | "error";

export interface SceneLook {
  pose: Pose;
  screen: Screen;
  /** Solo los estados en curso se mueven; el resto es una imagen fija. */
  animated: boolean;
  /** Color del aro sobre el escritorio. */
  ring: string;
  inactive: boolean;
}

const RING = {
  online: "#12B76A",
  cobalt: "#5B74FF",
  warn: "#F5B800",
  signal: "#FF4B2B",
  danger: "#F04438",
  muted: "#667085",
  paper: "#F1F3EE",
} as const;

const LOOK: Record<AgentStatus, Omit<SceneLook, "inactive">> = {
  available: { pose: "idle", screen: "idle", animated: false, ring: RING.online },
  receiving: { pose: "reading", screen: "active", animated: true, ring: RING.cobalt },
  working: { pose: "typing", screen: "active", animated: true, ring: RING.cobalt },
  thinking: { pose: "thinking", screen: "active", animated: true, ring: RING.warn },
  researching: { pose: "typing", screen: "active", animated: true, ring: "#22D3EE" },
  executing_tool: { pose: "typing", screen: "active", animated: true, ring: RING.cobalt },
  waiting_agent: { pose: "waiting", screen: "idle", animated: false, ring: RING.muted },
  waiting_approval: { pose: "alert", screen: "warning", animated: true, ring: RING.signal },
  reviewing: { pose: "reading", screen: "active", animated: true, ring: "#E879F9" },
  completed: { pose: "done", screen: "idle", animated: false, ring: RING.paper },
  error: { pose: "alert", screen: "error", animated: false, ring: RING.danger },
  blocked: { pose: "alert", screen: "warning", animated: false, ring: RING.signal },
};

const PILOT = new Set<string>(PILOT_AGENT_IDS);

export function isPilotAgent(id: string): boolean {
  return PILOT.has(id);
}

export function sceneLook(agentId: string, status: AgentStatus): SceneLook {
  if (!isPilotAgent(agentId)) {
    return { pose: "off", screen: "off", animated: false, ring: RING.muted, inactive: true };
  }
  return { ...LOOK[status], inactive: false };
}

/** Hay algo que animar: si no, la escena no redibuja (frameloop «demand»). */
export function needsAnimation(agents: { id: string; status: AgentStatus }[], reducedMotion: boolean): boolean {
  return !reducedMotion && agents.some((a) => sceneLook(a.id, a.status).animated);
}

export type ViewMode = "3d" | "list";

export interface Capabilities {
  webgl: boolean;
  width: number;
  reducedMotion: boolean;
  saved: ViewMode | null;
}

/**
 * Vista inicial: la lista salvo que el equipo pueda con el 3D. En móvil
 * (< 768 px) se abre en lista, pero el usuario puede elegir 3D; sin WebGL,
 * nunca.
 */
export function chooseView(c: Capabilities): ViewMode {
  if (!c.webgl) return "list";
  if (c.saved) return c.saved;
  if (c.width < 768 || c.reducedMotion) return "list";
  return "3d";
}
