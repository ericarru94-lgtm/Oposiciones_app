import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { PILOT_AGENT_IDS, getAgent } from "@/lib/agents/registry";
import { requireAdminApi } from "@/lib/auth/session";
import { readEnv } from "@/lib/env";

// Comprueba que los modelos configurados existen y están disponibles para
// esta clave (GET /v1/models/{id}: no consume tokens ni tiene coste).
export async function GET() {
  const admin = await requireAdminApi();
  if (!admin) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  if (!readEnv().ANTHROPIC_API_KEY) return NextResponse.json({ error: "Falta ANTHROPIC_API_KEY." }, { status: 503 });

  const client = new Anthropic({ maxRetries: 0, timeout: 20_000 });
  const wanted = [...new Set(PILOT_AGENT_IDS.map((id) => getAgent(id)!.model))];
  const models = await Promise.all(
    wanted.map(async (id) => {
      try {
        const m = await client.models.retrieve(id);
        return { id, available: m.id === id, name: m.display_name };
      } catch (error) {
        const status = error instanceof Anthropic.APIError ? error.status : undefined;
        return { id, available: false, error: status ? `HTTP ${status}` : "Sin conexión" };
      }
    }),
  );
  const agents = PILOT_AGENT_IDS.map((id) => {
    const a = getAgent(id)!;
    return { id, model: a.model, effort: a.effort };
  });
  return NextResponse.json({ ok: models.every((m) => m.available), models, agents });
}
