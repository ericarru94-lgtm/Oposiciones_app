"use server";
import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireViewer } from "@/lib/auth/session";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";

export type CancelState = { message: string | null };

/**
 * Detiene una misión y todas sus subtareas. Las llamadas a Claude que estén
 * en curso cuentan como gastadas (su coste real se registra si llega).
 * cancel_mission solo la puede ejecutar el servidor; aquí se exige antes la
 * sesión del administrador.
 */
export async function cancelMission(_prev: CancelState, form: FormData): Promise<CancelState> {
  const viewer = await requireViewer();
  if (viewer.mode !== "admin") return { message: "Conecta Supabase para detener misiones." };
  const id = z.string().uuid().safeParse(form.get("missionId"));
  if (!id.success) return { message: "Misión no válida." };

  const { data, error } = await createSupabaseServiceClient().rpc("cancel_mission", {
    p_mission_id: id.data,
    p_reason: "Detenida por el administrador.",
  });
  if (error) return { message: "No se pudo detener la misión." };
  const supabase = await createSupabaseServerClient();
  await supabase.from("activity_log").insert({
    actor_type: "admin",
    actor_id: viewer.userId,
    action: "mission.cancelled",
    entity_type: "task",
    entity_id: id.data,
    details: { tasks_cancelled: data },
  });
  revalidatePath(`/tareas/${id.data}`);
  return { message: "Misión detenida." };
}
