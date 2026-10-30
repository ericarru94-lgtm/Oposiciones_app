import "server-only";
import type { Viewer } from "../auth/session";
import { createSupabaseServerClient } from "../supabase/server";

export interface BudgetStatus {
  monthSpentUsd: number;
  monthlyLimitUsd: number | null;
  taskLimitUsd: number | null;
  missionLimitUsd: number | null;
  exceeded: boolean;
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Gasto del mes (ai_usage + reservas abiertas o inciertas) y límites guardados en settings. */
export async function getBudgetStatus(viewer: Viewer): Promise<BudgetStatus | null> {
  if (viewer.mode === "local-preview") return null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("ai_budget_status").single<{
    month_spent_usd: string | number;
    monthly_limit_usd: string | number | null;
    task_limit_usd: string | number | null;
    exceeded: boolean;
  }>();
  if (error) throw new Error(`No se pudo leer el presupuesto: ${error.message}`);
  const { data: limits } = await supabase.from("settings").select("value").eq("key", "limits").maybeSingle();
  return {
    missionLimitUsd: num((limits?.value as Record<string, unknown> | null)?.mission_ai_budget_usd),
    monthSpentUsd: Number(data.month_spent_usd),
    monthlyLimitUsd: num(data.monthly_limit_usd),
    taskLimitUsd: num(data.task_limit_usd),
    exceeded: data.exceeded,
  };
}
