"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireViewer } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const missionSchema = z.object({
  title: z.string().trim().min(3, "Pon un título (mínimo 3 caracteres).").max(200),
  description: z.string().trim().min(20, "Describe el encargo (mínimo 20 caracteres).").max(8000),
  nonce: z.string().uuid(),
});

export type MissionState = { message: string | null };

/**
 * Crea un encargo para Alex. Solo lo crea: la ejecución empieza cuando abres
 * el encargo (la página pide pasadas del motor mientras está abierta).
 * El nonce del formulario evita duplicados si se envía dos veces.
 */
export async function createMission(_prev: MissionState, form: FormData): Promise<MissionState> {
  const viewer = await requireViewer();
  if (viewer.mode !== "admin") return { message: "Conecta Supabase para crear encargos." };
  const parsed = missionSchema.safeParse({ title: form.get("title"), description: form.get("description"), nonce: form.get("nonce") });
  if (!parsed.success) return { message: parsed.error.issues[0]?.message ?? "Revisa el encargo." };

  const supabase = await createSupabaseServerClient();
  const key = `mission:${parsed.data.nonce}`;
  const { data: existing } = await supabase.from("tasks").select("id").eq("idempotency_key", key).maybeSingle();
  let id = existing?.id as string | undefined;
  if (!id) {
    const { data, error } = await supabase
      .from("tasks")
      .insert({
        title: parsed.data.title,
        description: parsed.data.description,
        agent_id: "alex",
        status: "assigned",
        priority: "normal",
        created_by: "admin",
        idempotency_key: key,
        input: { kind: "mission", phase: "planning", round: 1 },
        // El encargo espera a su equipo: margen de un día para todo el ciclo.
        timeout_seconds: 86_400,
      })
      .select("id")
      .single();
    if (error || !data) return { message: "No se pudo crear el encargo." };
    id = data.id as string;
    await supabase.from("activity_log").insert({
      actor_type: "admin",
      actor_id: viewer.userId,
      action: "mission.created",
      entity_type: "task",
      entity_id: id,
      details: { title: parsed.data.title },
    });
  }
  redirect(`/tareas/${id}`);
}
