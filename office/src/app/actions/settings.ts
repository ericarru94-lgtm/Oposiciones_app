"use server";

import { revalidatePath } from "next/cache";
import { requireViewer } from "@/lib/auth/session";
import { limitsError, parseAmount, readCeilings, type Limits } from "@/lib/domain/limits";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type LimitsState = { ok: boolean; message: string | null };

export async function updateLimits(_prev: LimitsState, form: FormData): Promise<LimitsState> {
  const viewer = await requireViewer();
  if (viewer.mode !== "admin") return { ok: false, message: "Conecta Supabase para guardar límites." };

  const supabase = await createSupabaseServerClient();
  // Techos aprobados: los define la base de datos (migración 0012), no el navegador.
  const { data: rawCeilings, error: ceilingsError } = await supabase.rpc("settings_ceilings");
  const ceilings = ceilingsError ? null : readCeilings(rawCeilings);
  if (!ceilings) return { ok: false, message: "No se pudieron leer los máximos aprobados. No se ha guardado nada." };

  const value = {
    monthly_ai_budget_usd: parseAmount(form.get("monthly")),
    task_ai_budget_usd: parseAmount(form.get("task")),
    mission_ai_budget_usd: parseAmount(form.get("mission")),
  };
  const invalid = limitsError(value, ceilings);
  if (invalid) return { ok: false, message: invalid };

  // Solo se actualiza la fila existente (el navegador no puede crear ni borrar ajustes).
  const { data, error } = await supabase
    .from("settings")
    .update({ value: value as Limits })
    .eq("key", "limits")
    .select("key");
  if (error || !data?.length) return { ok: false, message: "No se pudieron guardar los límites." };

  await supabase.from("activity_log").insert({
    actor_type: "admin",
    actor_id: viewer.userId,
    action: "settings.limits_updated",
    entity_type: "settings",
    entity_id: "limits",
    details: value,
  });
  revalidatePath("/configuracion");
  return { ok: true, message: "Límites guardados." };
}
