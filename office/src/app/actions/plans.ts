"use server";
import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireViewer } from "@/lib/auth/session";
import { MAX_PLAN_VERSIONS, PLAN_HASH } from "@/lib/domain/plan";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type PlanDecisionState = { message: string | null; ok?: boolean };

// Se decide sobre una versión y una huella exactas: lo que el administrador
// ha visto. Las funciones son SECURITY DEFINER y comprueban is_admin con la
// sesión del navegador (no se usa la clave del servidor).
const Base = z.object({
  missionId: z.string().uuid(),
  planId: z.string().uuid(),
  version: z.coerce.number().int().min(1).max(MAX_PLAN_VERSIONS),
  hash: z.string().regex(PLAN_HASH),
});
const Decision = z.discriminatedUnion("decision", [
  Base.extend({ decision: z.literal("approve"), note: z.string().trim().max(2000).optional() }),
  Base.extend({ decision: z.literal("changes"), reason: z.string().trim().min(3, "Explica qué cambios quieres (mínimo 3 caracteres).").max(2000) }),
  Base.extend({ decision: z.literal("reject"), reason: z.string().trim().min(3, "Indica el motivo del rechazo (mínimo 3 caracteres).").max(2000) }),
]);

/** Mensaje claro para el administrador (sin detalles internos de la base de datos). */
function friendly(message: string): string {
  if (/No autorizado/.test(message)) return "No tienes permiso para decidir sobre este plan.";
  if (/ha cambiado|ya no está pendiente|no está esperando/.test(message)) return "El plan ya no es el que tenías abierto. Vuelve a cargar la página.";
  if (/no cabe en el presupuesto/.test(message)) return `No se puede aprobar: ${message}`;
  if (/máximo de 3 versiones/.test(message)) return "Ya hay 3 versiones: apruébalo o recházalo definitivamente.";
  if (/no se puede asignar|herramienta|rondas/.test(message)) return `No se puede aprobar: ${message}`;
  return "No se pudo guardar la decisión.";
}

export async function decidePlan(_prev: PlanDecisionState, form: FormData): Promise<PlanDecisionState> {
  const viewer = await requireViewer();
  if (viewer.mode !== "admin") return { message: "Conecta Supabase para decidir sobre planes." };
  const parsed = Decision.safeParse({
    decision: form.get("decision"),
    missionId: form.get("missionId"),
    planId: form.get("planId"),
    version: form.get("version"),
    hash: form.get("hash"),
    note: form.get("note") ?? undefined,
    reason: form.get("reason") ?? undefined,
  });
  if (!parsed.success) return { message: parsed.error.issues[0]?.message ?? "Decisión no válida." };
  const d = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { data, error } =
    d.decision === "approve"
      ? await supabase.rpc("approve_mission_plan", { p_plan_id: d.planId, p_version: d.version, p_hash: d.hash, p_note: d.note || null })
      : await supabase.rpc("reject_mission_plan", { p_plan_id: d.planId, p_version: d.version, p_hash: d.hash, p_reason: d.reason, p_mode: d.decision });
  revalidatePath(`/tareas/${d.missionId}`);
  if (error) return { message: friendly(error.message) };
  if ((data as { ok?: boolean; reason?: string } | null)?.reason === "expired") {
    return { message: "El plan había caducado (72 h sin decisión): la misión se ha detenido." };
  }
  const done = { approve: "Plan aprobado: el equipo empieza con los pasos aprobados.", changes: "Cambios pedidos: Alex preparará una versión nueva.", reject: "Plan rechazado: la misión se ha cancelado." };
  return { message: done[d.decision], ok: true };
}
