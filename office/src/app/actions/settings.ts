"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireViewer } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const amount = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : Number(v.replace(",", "."))))
  .refine((v) => v === null || (Number.isFinite(v) && v >= 0 && v <= 10_000), "Importe no válido");

const limitsSchema = z
  .object({ monthly: amount, task: amount })
  .refine((l) => l.monthly === null || l.task === null || l.task <= l.monthly, {
    message: "El límite por tarea no puede superar el mensual.",
  });

export type LimitsState = { ok: boolean; message: string | null };

export async function updateLimits(_prev: LimitsState, form: FormData): Promise<LimitsState> {
  const viewer = await requireViewer();
  if (viewer.mode !== "admin") return { ok: false, message: "Conecta Supabase para guardar límites." };

  const parsed = limitsSchema.safeParse({ monthly: form.get("monthly") ?? "", task: form.get("task") ?? "" });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Revisa los importes." };

  const value = { monthly_ai_budget_usd: parsed.data.monthly, task_ai_budget_usd: parsed.data.task };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("settings").upsert({ key: "limits", value });
  if (error) return { ok: false, message: "No se pudieron guardar los límites." };

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
