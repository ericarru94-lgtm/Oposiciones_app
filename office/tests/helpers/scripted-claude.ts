// Claude simulado con guion: Alex delega → Marcus investiga y guarda → Sofia
// hace la estrategia → Alex sintetiza. Sin llamadas reales.
import type { ContentBlock, ModelClient, ModelRequest, ModelResponse } from "@/lib/engine/types";

export const usage = { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0, webSearchRequests: 0 };
const say = (text: string, model: string): ModelResponse => ({ content: [{ type: "text", text }], stopReason: "end_turn", usage, model });
const use = (id: string, name: string, input: Record<string, unknown>, model: string): ModelResponse => ({
  content: [{ type: "tool_use", id, name, input }], stopReason: "tool_use", usage, model,
});

export function lastToolResults(req: ModelRequest): string {
  const last = req.messages.at(-1);
  return Array.isArray(last?.content) ? (last.content as ContentBlock[]).map((b) => String(b.content ?? "")).join("\n") : "";
}
export const who = (req: ModelRequest) => /Eres (\w+),/.exec(req.system)?.[1] ?? "?";

/** Guion: Alex delega → Marcus investiga y guarda → Sofia hace la estrategia → Alex sintetiza. */
export class ScriptedClaude implements ModelClient {
  calls: ModelRequest[] = [];
  async create(req: ModelRequest): Promise<ModelResponse> {
    this.calls.push(structuredClone(req));
    const turn = (req.messages.length + 1) / 2; // 1, 2, 3… dentro de cada ejecución
    const first = String(req.messages[0].content);
    switch (who(req)) {
      case "Alex":
        if (first.includes("ENTREGAS DEL EQUIPO")) return say("# Informe final\n1. Gimnasio Real Uno (fuente: https://gym-uno.example/)", req.model);
        if (turn === 1) return use("tu-m", "tasks__delegate", { agent: "marcus", title: "Investigar gimnasios", instructions: "Fichas con fuentes verificables." }, req.model);
        if (turn === 2) {
          const marcusId = /task_id ([0-9a-f-]{36})/.exec(lastToolResults(req))![1];
          return use("tu-s", "tasks__delegate", { agent: "sofia", title: "Estrategia de captación", instructions: "Estrategia a partir de las fichas.", depends_on: [marcusId] }, req.model);
        }
        return say("Plan: Marcus investiga y Sofia prepara la estrategia.", req.model);
      case "Marcus":
        if (turn === 1)
          return {
            content: [
              { type: "tool_use", id: "m1", name: "crm__write", input: { name: "Gimnasio Real Uno", city: "Barcelona", need_detected: "No tiene reserva online (verificado en su web).", sources: ["https://gym-uno.example/"] } },
              { type: "tool_use", id: "m2", name: "email__send", input: { to: "info@gym-uno.example" } },
              { type: "tool_use", id: "m3", name: "tasks__delegate", input: { agent: "sofia", title: "x", instructions: "subdelegación" } },
            ],
            stopReason: "tool_use", usage: { ...usage, webSearchRequests: 2 }, model: req.model,
          };
        if (turn === 2) return use("m4", "content__draft", { title: "Ficha · Gimnasio Real Uno", kind: "client_file", content: "VERIFICADO: sin reserva online (https://gym-uno.example/). ESTIMADO: tiempo de respuesta alto." }, req.model);
        return say("Fichas listas: 1 empresa con fuente.", req.model);
      case "Sofia":
        if (turn === 1) return use("s1", "content__draft", { title: "Estrategia de captación", kind: "strategy", content: "PREVISIÓN: 2 reuniones al mes. RESULTADO REAL: ninguno todavía. Presupuesto estimado 0 €." }, req.model);
        return say("Estrategia lista.", req.model);
    }
    throw new Error(`Llamada inesperada de ${who(req)}`);
  }
}

