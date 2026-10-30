// Instrucciones del piloto y mensajes iniciales de cada fase.
//
// El sistema es estable (reglas comunes + agente + guía del piloto) para que
// la caché de prompts funcione; todo lo que cambia (fecha, encargo,
// resultados del equipo) va en el primer mensaje del usuario.

import type { AgentDefinition } from "../agents/registry";
import { composeSystemPrompt } from "../agents/prompts";
import { OUTCOME_LABEL, outcomeOf, pendingOf, type ResultData } from "./coordination";
import type { CompanyFact, DocumentSummary, MissionCompany, RelatedTask, TaskRow } from "./store";

const PILOT_COMMON = `Modo piloto de la oficina:
- Todo lo que produces es un BORRADOR interno. No hay herramientas para contactar, enviar, publicar, lanzar campañas ni gastar: no las pidas ni digas que lo has hecho.
- Usa solo las herramientas que tienes. Si algo no se puede hacer con ellas, dilo.
- Responde en Markdown claro. Termina con «Siguientes pasos».`;

// Cierre obligatorio de las subtareas: el motor lo lee para no confundir
// «ejecución terminada» con «objetivos completados».
const RESULT_BLOCK = `Al terminar, cierra SIEMPRE tu respuesta con este bloque (JSON válido), sin inventar nada:
\`\`\`resultado
{"resultado": "completed | completed_with_warnings | partially_completed", "objetivos_completados": ["…"], "objetivos_pendientes": ["…"], "avisos": ["…"]}
\`\`\`
Usa partially_completed si queda algún objetivo pendiente y completed_with_warnings si hay datos dudosos, antiguos o contradictorios.`;

const PILOT_GUIDES: Record<string, string> = {
  alex: `${PILOT_COMMON}

Tu papel en el piloto: coordinar a Marcus (investigación comercial y CRM) y Sofia (estrategia de marketing). Eres el único que delega. La misión tiene un presupuesto de 1 $ y un máximo de 5 empresas: pide a Marcus como mucho 5.
- Fase de planificación: lee la memoria, prepara un plan breve y delega con «tasks__delegate» una subtarea clara para cada agente (qué entregar, criterios, límites). Delega primero a Marcus y después a Sofia: el sistema hace que Sofia espere a que Marcus termine (si Marcus falla, Sofia trabaja igualmente con lo que haya). Cuando hayas delegado, explica el plan en texto y termina tu turno sin herramientas: el sistema te despertará cuando el equipo termine.
- Si la misión parte de fichas ya existentes del CRM, pide a Marcus que COMPLETE solo lo pendiente de esas fichas (sin volver a investigar lo verificado ni crear duplicados) y a Sofia que trabaje con ellas y con la entrega de Marcus.
- Fase de síntesis: revisa lo que entregó cada agente y la sección «FICHAS DEL CRM DE LA MISIÓN». Comprueba que los datos tienen fuente y que no hay cifras inventadas. Si falta algo imprescindible puedes pedir UNA corrección (una nueva subtarea concreta); si no, redacta el informe final.
- Nunca inventes resultados del equipo: usa solo sus entregas y las fichas del CRM de la misión (son datos reales con fuente aunque la subtarea que las creó haya fallado).
- Distingue siempre: subtarea FALLIDA (error; puede haber dejado fichas o documentos) y subtarea COMPLETADA SIN RESULTADOS (terminó bien pero no aportó nada). Nunca digas que no hay empresas identificadas si la sección de fichas tiene alguna.
- Usa el ESTADO DE RESULTADO de cada subtarea (COMPLETADA, COMPLETADA CON AVISOS, PARCIALMENTE COMPLETADA, FALLIDA): una ejecución terminada no significa objetivos completados. Cita los objetivos pendientes que declaró cada agente.
- Lo que recibió cada agente está en el «INVENTARIO DE ENTREGAS» del sistema: no lo deduzcas de los documentos ni afirmes que alguien recibió algo que no figure ahí.
- El informe final es tu respuesta de texto (se guarda solo). Debe estar priorizado: mejores oportunidades primero, con su motivo y su fuente, y un plan de actuación con lo que requiere aprobación del administrador.
- Antes de entregarlo, añade al final una sección «Control de coherencia» que confirme: (1) que cada ficha citada existe en «FICHAS DEL CRM DE LA MISIÓN» (con su id); (2) los documentos de Marcus y Sofia, por id; (3) el estado de resultado de cada subtarea según el sistema; (4) qué recibió cada agente según el inventario; (5) la separación entre resultados, inferencias y recomendaciones; (6) los datos contradictorios (marcados ⚠) o antiguos. Si encuentras una contradicción, dilo explícitamente. El sistema revisará además el informe de forma automática.`,
  marcus: `${PILOT_COMMON}

Reglas de investigación (obligatorias):
- Solo empresas reales que hayas encontrado con la búsqueda o la lectura web. Nunca inventes datos ni completes huecos por intuición.
- Guarda la URL de cada fuente. Cada ficha del CRM («crm__write») lleva sus URLs en «sources».
- Separa siempre: VERIFICADO (lo has visto en una fuente, con su URL), ESTIMADO (deducción tuya, explica el razonamiento) y NO ENCONTRADO.
- Si dos fuentes se contradicen, indícalo y cita ambas.
- No crees contactos personales en el CRM ni guardes emails. Solo fichas de empresa con datos públicos.
- Antes de crear fichas, consulta el CRM («crm__read») para no duplicar.
- Si te llegan fichas existentes de la misión: NO investigues de nuevo lo que ya está VERIFICADO con fuente. Completa solo lo PENDIENTE con «crm__write» indicando su company_id y una versión completa y actualizada de notes (VERIFICADO / ESTIMADO / PENDIENTE). No crees fichas nuevas de empresas que ya existen.
- Límites de la misión: como máximo 5 empresas EN TOTAL, contando las fichas reutilizadas (el sistema rechaza el exceso), y unas 15 búsquedas web. Prioriza calidad.
- El límite de 1 búsqueda web y 1 lectura es POR LLAMADA, no por tarea: cuando lo uses, continúa en tu siguiente turno. Antes de cada turno repasa los OBJETIVOS PENDIENTES y lo que ya has hecho; no repitas búsquedas ni lecturas que ya funcionaron. Termina solo cuando hayas completado los objetivos o no puedas avanzar más (si no queda presupuesto, el sistema te detendrá y conservará tu trabajo).
- Registra cada dato relevante en «facts» de «crm__write» (clave, valor, URL exacta, tipo de fuente, estado y la fecha que muestre la fuente si la muestra). La fecha de consulta y la confianza las pone el sistema: no las inventes. Si un dato contradice a otro, regístralo igualmente: quedan ambos.
- Guarda una ficha comercial por empresa con «content__draft» (kind client_file) o un único informe con todas, y termina con un resumen de lo encontrado.

${RESULT_BLOCK}`,
  sofia: `${PILOT_COMMON}

Reglas de estrategia (obligatorias):
- Trabaja con las fichas del CRM de la misión, los resultados de Marcus que te llegan en el mensaje y la memoria. Si la subtarea de Marcus falló, trabaja igualmente con las fichas que existan. No tienes acceso a internet: no cites fuentes que no aparezcan ahí.
- Separa siempre PREVISIÓN (hipótesis, estimación) de RESULTADO REAL (dato que ya existe en la memoria o en las fichas). Nunca presentes una previsión como resultado.
- Los presupuestos son estimaciones: indica de qué supuestos salen.
- Cualquier campaña o gasto es una propuesta para aprobación; no se ejecuta nada.
- Guarda la estrategia con «content__draft» (kind strategy) y resume las conclusiones en tu respuesta.
- Si un dato de una ficha está marcado ⚠ (contradicción) o tiene confianza baja, no lo uses como argumento de venta sin advertirlo.

${RESULT_BLOCK}`,
};

export function pilotSystemPrompt(agent: AgentDefinition): string {
  const guide = PILOT_GUIDES[agent.id];
  return composeSystemPrompt(guide ? `${agent.instructions}\n\n---\n\n${guide}` : agent.instructions);
}

function today(now: Date): string {
  return now.toLocaleDateString("es-ES", { timeZone: "Europe/Madrid", day: "numeric", month: "long", year: "numeric" });
}

/** Caracteres de cada documento del equipo que se pasan a Alex o a la subtarea siguiente. */
export const DOC_CHARS = 40_000;

const clip = (s: string | null | undefined, n: number) => (!s ? "" : s.length > n ? `${s.slice(0, n)}\n…(recortado)` : s);

function teamSection(children: RelatedTask[], docs: DocumentSummary[], companies: MissionCompany[], perDoc: number): string {
  return children
    .map((c) => {
      const own = docs.filter((d) => d.task_id === c.id);
      const fichas = companies.filter((x) => x.created_in_task === c.id).length;
      const counts = `Documentos: ${own.length} · fichas del CRM creadas: ${fichas}`;
      const noText = !(c.result ?? "").trim() || c.result?.trim() === "(Sin texto de respuesta.)";
      const empty = c.status === "completed" && own.length === 0 && fichas === 0 && noText;
      const rd = (c.result_data ?? null) as Partial<ResultData> | null;
      const outcome = outcomeOf(c);
      const declared = rd
        ? [
            rd.objectives_completed?.length ? `Objetivos completados: ${rd.objectives_completed.join(" · ")}` : "",
            rd.objectives_pending?.length ? `Objetivos PENDIENTES: ${rd.objectives_pending.join(" · ")}` : "",
            rd.warnings?.length ? `Avisos: ${rd.warnings.join(" · ")}` : "",
          ].filter(Boolean).join("\n")
        : "";
      const body =
        c.status === "completed"
          ? `ESTADO: ${empty ? "COMPLETADA SIN RESULTADOS" : outcome ? OUTCOME_LABEL[outcome] : "COMPLETADA"}. ${counts}.${declared ? `\n${declared}` : ""}\nResultado:\n${clip(c.result, 6000) || "(sin texto)"}`
          : c.status === "failed"
            ? `ESTADO: FALLIDA. Motivo: ${c.error ?? "sin detalle"}. ${counts} (antes del fallo; ver «FICHAS DEL CRM DE LA MISIÓN»).`
            : `ESTADO: ${c.status}. ${counts}.`;
      const attached = own.map((d) => `#### Documento «${d.title}» (id ${d.id}, ${d.kind})\n${clip(d.content, perDoc)}`).join("\n\n");
      return `### ${c.agent_id} · ${c.title} (task_id ${c.id})\n${body}${attached ? `\n\n${attached}` : ""}`;
    })
    .join("\n\n");
}

const SOURCE_LABEL: Record<string, string> = {
  official_direct: "web oficial", official_indirect: "fuente oficial indirecta", directory: "directorio",
  third_party: "tercero", self_declared: "autodeclarado", inference: "inferencia", none: "sin fuente",
};

/** Fichas completas: ID, empresa, fuentes, verificado, estimado y pendiente, y sus datos con procedencia. */
export function companiesSection(companies: MissionCompany[], reuseIds: string[], facts: CompanyFact[] = []): string {
  if (companies.length === 0) return "FICHAS DEL CRM DE LA MISIÓN (0): todavía no hay ninguna.";
  const items = companies.map((x) => {
    const origin = reuseIds.includes(x.id) ? "reutilizada de una misión anterior" : `creada en esta misión por ${x.created_by}`;
    const own = facts.filter((f) => f.company_id === x.id);
    const factLines = own.map((f) =>
      `- ${f.in_contradiction ? "⚠ " : ""}${f.fact_key}: ${f.fact_value} · ${f.verification_status} · confianza ${f.confidence_score} (${SOURCE_LABEL[f.source_type] ?? f.source_type}) · consultado ${f.observed_at.slice(0, 10)}${f.source_date ? ` · fuente del ${f.source_date}` : ""}${f.source_url ? ` · ${f.source_url}` : ""}${f.in_contradiction ? " · CONTRADICCIÓN con otro valor registrado" : ""}`);
    return [
      `### ${x.name} · ${x.city ?? "sin ciudad"} (id ${x.id}) · ${origin}`,
      `Web: ${x.website ?? "—"} · Instagram: ${x.instagram ?? "—"} · Teléfono: ${x.phone ?? "—"}`,
      `Necesidad detectada: ${x.need_detected ?? "—"}`,
      x.recommended_service ? `Servicio recomendado: ${x.recommended_service}` : "",
      x.notes ? `Notas (verificado / estimado / pendiente): ${x.notes}` : "",
      factLines.length ? `Datos con procedencia (${factLines.length}):\n${factLines.join("\n")}` : "",
      `Fuentes: ${x.source}`,
    ].filter(Boolean).join("\n");
  });
  return `FICHAS DEL CRM DE LA MISIÓN (${companies.length}):\n\n${items.join("\n\n")}`;
}

/** A · Lo que las fichas marcan como pendiente: la lista de trabajo de Marcus. */
function objectivesSection(companies: MissionCompany[]): string {
  const rows = companies.map((x) => ({ x, p: pendingOf(x) })).filter((r) => r.p);
  if (rows.length === 0) return "";
  return `OBJETIVOS PENDIENTES (según las fichas):\n${rows.map((r) => `- ${r.x.name} (id ${r.x.id}): ${r.p}`).join("\n")}`;
}

export interface PromptContext {
  task: TaskRow;
  children: RelatedTask[];
  dependencies: RelatedTask[];
  documents: DocumentSummary[];
  /** Fichas del CRM de la misión (creadas en ella + reutilizadas). */
  companies?: MissionCompany[];
  reuseIds?: string[];
  maxCompanies?: number;
  /** Datos con procedencia de las fichas. */
  facts?: CompanyFact[];
  /** C · Inventario de entregas (solo para la síntesis de Alex). */
  inventory?: string;
  now?: Date;
}

export function initialPrompt(c: PromptContext): string {
  const { task } = c;
  const date = `Fecha de hoy: ${today(c.now ?? new Date())}.`;
  const companies = c.companies ?? [];
  const reuse = c.reuseIds ?? [];
  const max = c.maxCompanies ?? 5;
  const fichas = companiesSection(companies, reuse, c.facts ?? []);
  const quota = `Tope de la misión: ${max} empresas en total; ya hay ${companies.length}${reuse.length ? ` (${reuse.length} reutilizadas)` : ""}.`;

  if (task.input.kind === "mission" && task.input.phase === "synthesis") {
    return `${date}\n\nENCARGO DEL ADMINISTRADOR:\n${task.title}\n\n${task.description}\n\nTu plan anterior:\n${clip(task.result, 4000)}\n\nENTREGAS DEL EQUIPO:\n\n${teamSection(c.children, c.documents, companies, DOC_CHARS)}\n\n${c.inventory ?? "INVENTARIO DE ENTREGAS: no disponible."}\n\n${fichas}\n\nRevisa las entregas y las fichas. Si falta algo imprescindible y todavía puedes, delega UNA corrección concreta y termina tu turno. Si no, escribe ahora el informe final priorizado (será tu respuesta).`;
  }
  if (task.input.kind === "mission") {
    // Reintento tras un fallo: lo ya delegado no se repite.
    const done = c.children.length
      ? `\n\nSubtareas que ya creaste en un intento anterior (no las repitas):\n${c.children.map((k) => `- ${k.agent_id}: ${k.title} (task_id ${k.id}, ${k.status})`).join("\n")}`
      : "";
    const reuseNote = reuse.length
      ? `\n\nEsta misión parte de ${reuse.length} fichas ya investigadas. ${quota} Pide a Marcus que complete solo lo PENDIENTE de esas fichas (con su company_id), sin investigarlas de nuevo ni duplicarlas, y a Sofia que trabaje con ellas (el sistema la hará esperar a Marcus; si Marcus falla, trabaja igualmente).\n\n${fichas}`
      : "";
    return `${date}\n\nENCARGO DEL ADMINISTRADOR:\n${task.title}\n\n${task.description}${done}${reuseNote}\n\nPlanifica y delega en Marcus y Sofia según tus instrucciones.`;
  }
  const deps = c.dependencies.length ? `\n\nRESULTADOS PREVIOS DEL EQUIPO:\n\n${teamSection(c.dependencies, c.documents, companies, DOC_CHARS)}` : "";
  const objectives = objectivesSection(companies);
  return `${date}\n\nTAREA ASIGNADA POR ALEX:\n${task.title}\n\n${task.description}${deps}\n\n${quota}${objectives ? `\n\n${objectives}` : ""}\n\n${fichas}`;
}
