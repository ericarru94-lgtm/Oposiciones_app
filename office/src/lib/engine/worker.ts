// Ejecutor del piloto: una «pasada» (tick) dentro del límite de una función
// de Vercel Hobby. Reclama tareas, ejecuta pasos del bucle con reserva de
// tiempo y deja todo el estado en la base de datos. Si se corta, el lease
// caduca y otra pasada la retoma (recover_stale / claim_next_task).

import { randomUUID } from "node:crypto";
import { PILOT_AGENT_IDS, getAgent } from "../agents/registry";
import { ENGINE, SERVER_TOOLS, pilotScope, type ServerToolId } from "./config";
import { initialState, runStep, type RunState, type StepOutcome } from "./loop";
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

const BUDGET_MESSAGE = {
  monthly_budget: "Se ha alcanzado el límite mensual de gasto en IA. La tarea se ha detenido.",
  task_budget: "Se ha alcanzado el límite de gasto por tarea. La tarea se ha detenido.",
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
    const outcome = await runClaimed(deps, worker, claimed, () => timeLeft() > reserve);
    report.runs.push({ taskId: claimed.taskId, agentId: claimed.agentId, outcome });
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
  const serverTools = agent.tools
    .filter((t): t is ServerToolId => Object.hasOwn(SERVER_TOOLS, t))
    .map((t) => ({ ...SERVER_TOOLS[t] }));

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

  while (true) {
    await store.activity(run.runId, worker, serverTools.length ? "researching" : "thinking", serverTools.length ? "researching" : "thinking", task.title);

    const outcome: StepOutcome = await runStep({
      agent, runId: run.runId, taskId: task.id, state, client: deps.client, gateway,
      engine: store.enginePort(run.runId, worker), toolSchemas: PILOT_SCHEMAS, serverTools,
      system: pilotSystemPrompt(def), maxSteps: ENGINE.maxStepsPerRun,
    });
    state = outcome.state;

    // Sin tiempo para otra llamada: el paso se guarda y la tarea se libera
    // para que la siguiente pasada la retome sin contarla como abandonada.
    const yieldNow = outcome.kind === "continue" && !canStep();
    if (outcome.model) {
      const rec = await store.recordStep({
        runId: run.runId, worker, state, model: outcome.model,
        inputTokens: outcome.usage.inputTokens, outputTokens: outcome.usage.outputTokens,
        cacheReadTokens: outcome.usage.cacheReadTokens, cacheWriteTokens: outcome.usage.cacheWriteTokens,
        serverToolRequests: outcome.usage.webSearchRequests,
        costUsd: outcome.costUsd, agentStatus: outcome.researched ? "researching" : "working", release: yieldNow,
      });
      if (!rec.continue && rec.reason) {
        // El paso ya está pagado y registrado; no se hace ninguna llamada más.
        await store.failRun(run.runId, worker, BUDGET_MESSAGE[rec.reason], false);
        return "budget_stop";
      }
    }

    switch (outcome.kind) {
      case "continue":
        if (yieldNow) return "yielded";
        continue;
      case "waiting_approval":
        await store.pauseForApproval(run.runId, worker, state);
        return "waiting_approval";
      case "failed":
        return (await store.failRun(run.runId, worker, outcome.error, outcome.retryable)) === "failed" ? "failed" : "retry_scheduled";
      case "completed":
        return finish(store, worker, run, task, outcome.result);
    }
  }
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
