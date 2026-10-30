import "server-only";
import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth/session";
import { readEnv } from "@/lib/env";
import { AnthropicModelClient } from "@/lib/engine/anthropic";
import { SupabaseEngineStore } from "@/lib/engine/store-supabase";
import { runTick } from "@/lib/engine/worker";

// Una pasada del motor. Solo el administrador puede lanzarla (la oficina la
// pide mientras tienes un encargo abierto). Varias pasadas a la vez son
// seguras: cada tarea tiene un lease en la base de datos.
export const maxDuration = 300;

export async function POST() {
  const admin = await requireAdminApi();
  if (!admin) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  if (!readEnv().ANTHROPIC_API_KEY) return NextResponse.json({ error: "Falta ANTHROPIC_API_KEY." }, { status: 503 });
  try {
    const report = await runTick({ store: new SupabaseEngineStore(), client: new AnthropicModelClient() });
    return NextResponse.json(report);
  } catch (error) {
    console.error("engine tick", error);
    return NextResponse.json({ error: "La pasada del motor ha fallado. Revisa el historial de la tarea." }, { status: 500 });
  }
}
