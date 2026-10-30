// Ejecutor del piloto: una «pasada» (tick) dentro del límite de una función
// de Vercel Hobby. Todo el estado vive en la base de datos; el navegador solo
// pide pasadas. Por cada llamada a Claude:
//
//   1. reserve_budget  reserva atómica de gasto (mensual, misión, tarea) y
//                      renovación del lease. Sin saldo → la tarea se detiene.
//   2. callModel       la llamada (timeout 150 s < lease 240 s).
//   3. record_call     coste real (Claude y búsquedas) y respuesta guardados
//                      ANTES de ejecutar herramientas.
//   4. resolveLocal    herramientas idempotentes por tool_use_id.
//
// Respuesta perdida o proceso cortado en mitad de una llamada → la reserva
// queda «incierta» (cuenta como gastada) y la llamada NO se repite sola.

import { randomUUID } from "node:crypto";
import { PILOT_AGENT_IDS, getAgent } from "../agents/registry";
import { ENGINE, SERVER_TOOLS, pilotScope, type ServerToolId } from "./config";
import { buildModelRequest, callModel, initialState, resolveLocal, type RunState, type StepInput } from "./loop";
import { estimateTokens, reserveUsd } from "./cost";
import { PILOT_SCHEMAS, pilotGateway } from "./pilot-tools";
import { initialPrompt, pilotSystemPrompt } from "./pilot-prompts";
import type { ClaimedRun, EngineStore } from "./store";
import type { ModelClient } from "./types";

export interface TickDeps {
  store: EngineStore;
  client: ModelClient;
  worker?: string;
  budgetMs?: number;
  stepReserveMs?: number;
  now?: () => number;
}

export interface TickReport {
  worker: string;
  runs: { taskId: string; agentId: string; outcome: string }[];
}

function isRunState(x: unknown): x is RunState {
  return !!x && typeof x === "object" && Array.isArray((x as RunState).messages) && (x as RunState).messages.length > 0;
}

const STOP_MESSAGE = {
  monthly_budget: "Se ha alcanzado el límite mensual de gasto en IA. La tarea se ha detenido.",
  mission_budget: "Se ha alcanzado el límite de gasto de la misión. La tarea se ha detenido.",
  task_budget: "Se ha alcanzado el límite de gasto por tarea. La tarea se ha detenido.",
  uncertain:
    "Una llamada anterior a Claude quedó con resultado incierto (el proceso se cortó o se perdió la respuesta). Cuenta como gastada y no se repite automáticamente.",
} as const;

export async function runTick(deps: TickDeps): Promise<TickReport> {
  const now = deps.now ?? Date.now;
  const start = now();
  const budget = deps.budgetMs ?? ENGINE.tickBudgetMs;
  const reserve = deps.stepReserveMs ?? ENGINE.stepReserveMs;
  const worker = deps.worker ?? `tick-${randomUUID()}`;
  const timeLeft = () => budget - (now() - start);
  const report: TickReport = { worker, runs: [] };

  await deps.store.recoverStale();
  while (timeLeft() > reserve) {
    const claimed = await deps.store.claim(worker, ENGINE.leaseSeconds, ENGINE.maxParallelRuns);
    if (!claimed) break;
    try {
      const outcome = await runClaimed(deps, worker, claimed, () => timeLeft() > reserve);
      report.runs.push({ taskId: claimed.taskId, agentId: claimed.agentId, outcome });
    } catch (error) {
      // El estado guardado está a salvo; el lease caduca y otra pasada la retoma.
      console.error("engine run", claimed.taskId, error);
      report.runs.push({ taskId: claimed.taskId, agentId: claimed.agentId, outcome: "error" });
      break;
    }
  }
  return report;
}

async function runClaimed(deps: TickDeps, worker: string, run: ClaimedRun, canStep: () => boolean): Promise<string> {
  const { store } = deps;
  const def = getAgent(run.agentId);
  if (!def || !(PILOT_AGENT_IDS as readonly string[]).includes(run.agentId)) {
    await store.failRun(run.runId, worker, `«${run.agentId}» no participa en el piloto.`, false);
    return "failed";
  }
  const agent = pilotScope(def);
  const task = await store.getTask(run.taskId);
  if (task.parent_task_id && (await store.getTask(task.parent_task_id)).status === "failed") {
    // Encargo principal detenido (presupuesto, error…): no se gasta más en él.
    await store.failRun(run.runId, worker, "El encargo principal se ha detenido; esta subtarea no se ejecuta.", false);
    return "parent_stopped";
  }
  const allowedServerTools = agent.tools.filter((t): t is ServerToolId => Object.hasOwn(SERVER_TOOLS, t));

  let state: RunState;
  const saved = await store.loadRunState(run.runId);
  if (isRunState(saved)) {
    state = saved;
  } else {
    const isMission = task.input.kind === "mission";
    const children = isMission ? await store.children(task.id) : [];
    const dependencies = isMission ? [] : await store.dependencies(task.id);
    const related = (isMission ? children : dependencies).map((t) => t.id);
    const documents = await store.documentsOfTasks(related);
    state = initialState(initialPrompt({ task, children, dependencies, documents }));
  }

  const gateway = pilotGateway({ store, runId: run.runId, taskId: task.id, worker, clientId: task.client_id });
  const base: Omit<StepInput, "state"> = {
    agent, runId: run.runId, taskId: task.id, client: deps.client, gateway,
    engine: store.enginePort(run.runId, worker), toolSchemas: PILOT_SCHEMAS,
    system: pilotSystemPrompt(def), maxSteps: ENGINE.maxStepsPerRun,
  };

  while (true) {
    // ── Herramientas pendientes, aprobaciones y fin (sin llamar a Claude) ──
    const local = await resolveLocal({ ...base, state });
    state = local.state;
    if (local.kind === "waiting_approval") {
      await store.pauseForApproval(run.runId, worker, state);
      return "waiting_approval";
    }
    if (local.kind === "failed") {
      await store.failRun(run.runId, worker, local.error, false);
      return "failed";
    }
    if (local.kind === "completed") return finish(store, worker, run, task, local.result);

    if (!canStep()) {
      // Sin tiempo para otra llamada: se guarda y se libera para la siguiente pasada.
      await store.saveRunState(run.runId, worker, state, true);
      return "yielded";
    }
    if (local.changed) await store.saveRunState(run.runId, worker, state, false);

    // ── 1. Reserva atómica (y renovación del lease) ──
    const wanted = allowedServerTools.includes("web.search") ? SERVER_TOOLS["web.search"].max_uses : 0;
    const fetches = allowedServerTools.includes("web.fetch") ? SERVER_TOOLS["web.fetch"].max_uses : 0;
    const draft = buildModelRequest({ ...base, state, serverTools: serverToolsFor(allowedServerTools, wanted) });
    const estimate = reserveUsd(agent.model, estimateTokens([draft.system, draft.messages, draft.tools, draft.serverTools]), {
      maxOutputTokens: ENGINE.maxTokens, searches: wanted, fetches, fetchTokens: SERVER_TOOLS["web.fetch"].max_content_tokens,
    });
    const reservation = await store.reserve(run.runId, worker, agent.model, estimate, wanted);
    if (!reservation.ok) {
      await store.failRun(run.runId, worker, STOP_MESSAGE[reservation.reason], false);
      return reservation.reason === "uncertain" ? "uncertain" : "budget_stop";
    }
    const serverTools = serverToolsFor(allowedServerTools, reservation.searches);
    const searching = serverTools.length > 0;
    await store.activity(run.runId, worker, searching ? "researching" : "thinking", searching ? "researching" : "thinking", task.title);

    // ── 2. Llamada ──
    const request = buildModelRequest({ ...base, state, serverTools });
    const call = await callModel({ ...base, state, serverTools }, request);
    if (call.kind === "error") {
      if (call.billing === "unknown") {
        await store.closeReservation(run.runId, reservation.reservation_id, true);
        await store.failRun(run.runId, worker, `${call.error} ${STOP_MESSAGE.uncertain}`, false);
        return "uncertain";
      }
      await store.closeReservation(run.runId, reservation.reservation_id, false);
      const retries = state.transientRetries ?? 0;
      if (call.retryable && retries < ENGINE.maxTransientRetries) {
        state = { ...state, transientRetries: retries + 1 };
        await store.deferRun(run.runId, worker, state, 30 * 2 ** retries, call.error);
        return "deferred";
      }
      await store.failRun(run.runId, worker, call.error, false);
      return "failed";
    }

    // ── 3. Coste real y respuesta guardados antes de tocar herramientas ──
    state = { ...call.state, transientRetries: 0 };
    const rec = await store.recordCall({
      runId: run.runId, worker, reservationId: reservation.reservation_id, state, model: call.model,
      inputTokens: call.usage.inputTokens, outputTokens: call.usage.outputTokens,
      cacheReadTokens: call.usage.cacheReadTokens, cacheWriteTokens: call.usage.cacheWriteTokens,
      serverToolRequests: call.usage.webSearchRequests, claudeUsd: call.claudeUsd, searchUsd: call.searchUsd,
      agentStatus: call.researched ? "researching" : "working",
    });
    if (!rec.continue) return "lease_lost"; // el gasto ya está registrado; otra pasada decide
    // 4. En la siguiente vuelta: herramientas, fallo definitivo o fin.
  }
}

function serverToolsFor(allowed: ServerToolId[], searches: number) {
  return allowed
    .filter((t) => t !== "web.search" || searches > 0)
    .map((t) => (t === "web.search" ? { ...SERVER_TOOLS[t], max_uses: searches } : { ...SERVER_TOOLS[t] }));
}

async function finish(store: EngineStore, worker: string, run: ClaimedRun, task: Awaited<ReturnType<EngineStore["getTask"]>>, result: string): Promise<string> {
  const text = result.trim() || "(Sin texto de respuesta.)";
  if (task.input.kind === "mission") {
    const pending = (await store.children(task.id)).filter((c) => c.status !== "completed" && c.status !== "failed");
    if (pending.length > 0) {
      // Alex nunca cierra con subtareas pendientes: espera y vuelve en síntesis.
      await store.awaitSubtasks(run.runId, worker, text);
      return "waiting_agents";
    }
    await saveOnce(store, run, task, `Informe final: ${task.title}`, "report", text);
  } else if ((await store.documentsOfTasks([task.id])).length === 0) {
    await saveOnce(store, run, task, `Entrega: ${task.title}`, "report", text);
  }
  await store.completeRun(run.runId, worker, text);
  return "completed";
}

async function saveOnce(store: EngineStore, run: ClaimedRun, task: { id: string; client_id: string | null }, title: string, kind: string, content: string) {
  const docs = await store.documentsOfTasks([task.id]);
  if (docs.some((d) => d.title === title.slice(0, 300))) return; // reintento tras un corte
  await store.createDocument({
    title: title.slice(0, 300), kind, content, task_id: task.id, run_id: run.runId, agent_id: run.agentId,
    client_id: task.client_id, source: `agente:${run.agentId}`, created_by: run.agentId,
  });
}
