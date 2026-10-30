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
import { ENGINE, SEARCH_RESULT_TOKENS_ASSUMED, SERVER_TOOLS, SERVER_TOOL_OVERHEAD_TOKENS, callLimits, pilotScope, type ServerToolId } from "./config";
import { budgetStopMessage } from "./budget-message";
import { buildModelRequest, callModel, initialState, resolveLocal, type RunState, type StepInput } from "./loop";
import { estimateTokens, reserveUsd } from "./cost";
import { PILOT_SCHEMAS, pilotGateway } from "./pilot-tools";
import { DOC_CHARS, initialPrompt, pilotSystemPrompt } from "./pilot-prompts";
import { buildDeliveries, coherenceCheck, inventorySection, subtaskOutcome, type ResultData } from "./coordination";
import type { ClaimedRun, EngineStore } from "./store";
import type { ModelClient, ModelRequest } from "./types";

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

const PROGRESS_NOTE =
  "[Sistema] Fin de esta ronda. El límite de 1 búsqueda y 1 lectura web es POR LLAMADA: puedes seguir en tu siguiente turno. " +
  "Repasa los OBJETIVOS PENDIENTES y lo ya hecho, no repitas búsquedas ni lecturas que ya funcionaron y termina solo si has completado los objetivos o no puedes avanzar.";

const STOP_MESSAGE = {
  searches:
    "Tarea detenida: se alcanzó el máximo de búsquedas web de la misión. Las fichas y documentos ya creados se conservan.",
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
      // Cada paso exige tiempo para la llamada completa de ese agente + 20 s.
      const outcome = await runClaimed(deps, worker, claimed, (callMs) => timeLeft() > Math.max(reserve, callMs + 20_000));
      report.runs.push({ taskId: claimed.taskId, agentId: claimed.agentId, outcome });
      // Sin tiempo para la llamada de ese agente: se termina la pasada (si no,
      // volvería a coger la misma tarea en bucle). La siguiente pasada la retoma.
      if (outcome === "yielded") break;
    } catch (error) {
      // El estado guardado está a salvo; el lease caduca y otra pasada la retoma.
      console.error("engine run", claimed.taskId, error);
      report.runs.push({ taskId: claimed.taskId, agentId: claimed.agentId, outcome: "error" });
      break;
    }
  }
  return report;
}

async function runClaimed(deps: TickDeps, worker: string, run: ClaimedRun, canStep: (callMs: number) => boolean): Promise<string> {
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
  const limits = callLimits(agent.id);

  // Misión y fichas del CRM de la misión (creadas en ella, aunque la subtarea
  // que las creó fallara, + las reutilizadas de una misión anterior).
  const mission = task.parent_task_id ? await store.getTask(task.parent_task_id) : task;
  const reuseIds = reuseIdsOf(mission.input);

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
    const companies = await store.missionCompanies(mission.id, reuseIds);
    const facts = await store.companyFacts(companies.map((c) => c.id));
    const maxCompanies = Number((await store.pilotSettings()).max_companies ?? 5);
    // C · Alex recibe en la síntesis el inventario exacto de lo que recibió cada agente.
    const inventory = isMission && task.input.phase === "synthesis"
      ? inventorySection(await store.missionDeliveries(mission.id), children)
      : undefined;
    state = initialState(initialPrompt({ task, children, dependencies, documents, companies, reuseIds, maxCompanies, facts, inventory }));
    // Entrega «preparada»: lo que contiene este mensaje, por emisor. Pasa a
    // «enviada» y «recibida» solo cuando la llamada ocurre de verdad.
    if (!(await store.runHasDeliveries(run.runId))) {
      await store.recordDeliveries(mission.id, task.id, run.runId, buildDeliveries(run.agentId, companies, documents, DOC_CHARS));
    }
  }

  const gateway = pilotGateway({ store, runId: run.runId, taskId: task.id, worker, clientId: task.client_id, missionId: mission.id, reuseIds });
  const base: Omit<StepInput, "state"> = {
    agent, runId: run.runId, taskId: task.id, client: deps.client, gateway,
    engine: store.enginePort(run.runId, worker), toolSchemas: PILOT_SCHEMAS,
    system: pilotSystemPrompt(def), maxSteps: ENGINE.maxStepsPerRun,
    // A · Con herramientas web, recordatorio tras cada ronda: el límite es por llamada.
    progressNote: allowedServerTools.length ? PROGRESS_NOTE : undefined,
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
    if (local.kind === "completed") return finish(store, worker, run, task, local.result, mission.id, reuseIds);

    if (!canStep(limits.timeoutMs)) {
      // Sin tiempo para otra llamada: se guarda y se libera para la siguiente pasada.
      await store.saveRunState(run.runId, worker, state, true);
      return "yielded";
    }
    if (local.changed) await store.saveRunState(run.runId, worker, state, false);

    // ── 1. Reserva atómica (y renovación del lease) ──
    // La lista de herramientas es IDÉNTICA en todas las llamadas de una
    // ejecución: Sonnet 5.5 ata su razonamiento a esa lista y rechaza (400) la
    // conversación si cambia. Marcus recibe siempre búsqueda y lectura (1 + 1
    // por llamada: hasta 3 pasadas, reservadas sin suponer caché).
    // La actividad se marca antes: entre la reserva y la llamada no hay nada
    // que pueda fallar y dejar una reserva incierta sin haber llamado.
    const serverTools = serverToolsFor(allowedServerTools);
    const searches = allowedServerTools.includes("web.search") ? SERVER_TOOLS["web.search"].max_uses : 0;
    const fetches = allowedServerTools.includes("web.fetch") ? SERVER_TOOLS["web.fetch"].max_uses : 0;
    const searching = serverTools.length > 0;
    await store.activity(run.runId, worker, searching ? "researching" : "thinking", searching ? "researching" : "thinking", task.title);
    const draft = buildModelRequest({ ...base, state, serverTools, maxTokens: limits.maxTokens });
    const promptTokens = (await promptTokensOf(deps.client, draft)) + (searching ? SERVER_TOOL_OVERHEAD_TOKENS : 0);
    const estimate = reserveUsd(agent.model, promptTokens, {
      maxOutputTokens: limits.maxTokens,
      searches,
      fetches,
      fetchTokens: SERVER_TOOLS["web.fetch"].max_content_tokens,
      searchResultTokens: SEARCH_RESULT_TOKENS_ASSUMED,
    });
    const reservation = await store.reserve(run.runId, worker, agent.model, estimate, searches, limits.leaseSeconds);
    if (!reservation.ok) {
      const message =
        reservation.reason === "uncertain"
          ? STOP_MESSAGE.uncertain
          : budgetStopMessage(reservation.reason, estimate, await store.budgetSnapshot(mission.id, task.id), task.parent_task_id !== null);
      await store.failRun(run.runId, worker, message, false);
      return reservation.reason === "uncertain" ? "uncertain" : "budget_stop";
    }
    if (reservation.searches < searches) {
      // Sin búsquedas restantes en la misión. Quitar la búsqueda cambiaría la
      // lista de herramientas (error 400), así que la tarea se detiene; sus
      // fichas y documentos se conservan y Alex informa con lo que haya.
      await store.closeReservation(run.runId, reservation.reservation_id, false);
      await store.failRun(run.runId, worker, STOP_MESSAGE.searches, false);
      return "searches_exhausted";
    }

    // ── 2. Llamada ──
    const firstCall = state.steps === 0;
    const request = buildModelRequest({ ...base, state, serverTools, maxTokens: limits.maxTokens, timeoutMs: limits.timeoutMs });
    const call = await callModel({ ...base, state, serverTools, maxTokens: limits.maxTokens, timeoutMs: limits.timeoutMs }, request);
    if (call.kind === "error") {
      // La petición se envió (aunque fallara): la entrega consta como «enviada», nunca «recibida».
      if (firstCall) await store.advanceDeliveries(run.runId, worker, "sent");
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
    // El gasto ya está registrado. Sobrecoste → la base de datos ya ha detenido la misión.
    if (!rec.continue) return rec.reason ?? "lease_lost";
    // Claude respondió a una petición que contenía la entrega: «recibida».
    if (firstCall) await store.advanceDeliveries(run.runId, worker, "received");
    // 4. En la siguiente vuelta: herramientas, fallo definitivo o fin.
  }
}

/** Tokens exactos con el contador oficial (gratuito); si falla, estimación prudente. */
async function promptTokensOf(client: ModelClient, req: ModelRequest): Promise<number> {
  if (client.countTokens) {
    try {
      return await client.countTokens({ ...req, serverTools: undefined });
    } catch {
      // El contador no admite algunos bloques (resultados web); se estima.
    }
  }
  return estimateTokens([req.system, req.messages, req.tools]);
}

/** Herramientas de servidor del agente: siempre las mismas y en el mismo orden. */
export function serverToolsFor(allowed: readonly ServerToolId[]) {
  return (["web.search", "web.fetch"] as const).filter((t) => allowed.includes(t)).map((t) => ({ ...SERVER_TOOLS[t] }));
}

function reuseIdsOf(input: Record<string, unknown>): string[] {
  const ids = input.reuse_company_ids;
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
}

async function finish(
  store: EngineStore, worker: string, run: ClaimedRun, task: Awaited<ReturnType<EngineStore["getTask"]>>, result: string,
  missionId: string, reuseIds: string[],
): Promise<string> {
  const text = result.trim() || "(Sin texto de respuesta.)";
  let resultData: ResultData;
  if (task.input.kind === "mission") {
    const children = await store.children(task.id);
    const pending = children.filter((c) => c.status !== "completed" && c.status !== "failed");
    if (pending.length > 0) {
      // Alex nunca cierra con subtareas pendientes: espera y vuelve en síntesis.
      await store.awaitSubtasks(run.runId, worker, text);
      return "waiting_agents";
    }
    // F · Control de coherencia automático del informe contra lo que existe.
    const companies = await store.missionCompanies(missionId, reuseIds);
    const documents = await store.documentsOfTasks(children.map((c) => c.id));
    const deliveries = await store.missionDeliveries(missionId);
    const facts = await store.companyFacts(companies.map((c) => c.id));
    const { checks, warnings } = coherenceCheck({
      report: text, companies, documents, tasks: children,
      knownIds: [task.id, ...deliveries.map((d) => d.id), ...facts.map((f) => f.id)],
    });
    resultData = {
      outcome: warnings.length ? "completed_with_warnings" : "completed",
      declared: false, objectives_completed: [], objectives_pending: [], warnings, coherence_checks: checks,
    };
    const control = [
      "",
      "---",
      "## Control automático de coherencia (sistema)",
      ...checks.map((c) => `- Comprobado: ${c}`),
      ...(warnings.length ? warnings.map((w) => `- ⚠ ${w}`) : ["- Sin contradicciones detectadas."]),
    ].join("\n");
    await saveOnce(store, run, task, `Informe final: ${task.title}`, "report", `${text}\n${control}`);
  } else {
    // D · Una ejecución terminada no implica objetivos completados.
    resultData = subtaskOutcome(text);
    if (result.trim() && (await store.documentsOfTasks([task.id])).length === 0) {
      // Sin texto no se guarda un documento vacío: la subtarea queda «completada sin resultados».
      await saveOnce(store, run, task, `Entrega: ${task.title}`, "report", text);
    }
  }
  await store.completeRun(run.runId, worker, text, resultData as unknown as Record<string, unknown>);
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
