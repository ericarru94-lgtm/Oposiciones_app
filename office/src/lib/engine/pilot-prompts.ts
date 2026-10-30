// Instrucciones del piloto y mensajes iniciales de cada fase.
//
// El sistema es estable (reglas comunes + agente + guía del piloto) para que
// la caché de prompts funcione; todo lo que cambia (fecha, encargo,
// resultados del equipo) va en el primer mensaje del usuario.

import type { AgentDefinition } from "../agents/registry";
import { composeSystemPrompt } from "../agents/prompts";
import type { DocumentSummary, RelatedTask, TaskRow } from "./store";

const PILOT_COMMON = `Modo piloto de la oficina:
- Todo lo que produces es un BORRADOR interno. No hay herramientas para contactar, enviar, publicar, lanzar campañas ni gastar: no las pidas ni digas que lo has hecho.
- Usa solo las herramientas que tienes. Si algo no se puede hacer con ellas, dilo.
- Responde en Markdown claro. Termina con «Siguientes pasos».`;

const PILOT_GUIDES: Record<string, string> = {
  alex: `${PILOT_COMMON}

Tu papel en el piloto: coordinar a Marcus (investigación comercial y CRM) y Sofia (estrategia de marketing). Eres el único que delega.
- Fase de planificación: lee la memoria, prepara un plan breve y delega con «tasks__delegate» una subtarea clara para cada agente (qué entregar, criterios, límites). Si Sofia necesita los resultados de Marcus, indica el task_id de Marcus en depends_on. Cuando hayas delegado, explica el plan en texto y termina tu turno sin herramientas: el sistema te despertará cuando el equipo termine.
- Fase de síntesis: revisa lo que entregó cada agente. Comprueba que los datos tienen fuente y que no hay cifras inventadas. Si falta algo imprescindible puedes pedir UNA corrección (una nueva subtarea concreta); si no, redacta el informe final.
- Nunca inventes resultados del equipo: usa solo lo que aparece en sus entregas. Si una subtarea falló, dilo y valora su impacto.
- El informe final es tu respuesta de texto (se guarda solo). Debe estar priorizado: mejores oportunidades primero, con su motivo y su fuente, y un plan de actuación con lo que requiere aprobación del administrador.`,
  marcus: `${PILOT_COMMON}

Reglas de investigación (obligatorias):
- Solo empresas reales que hayas encontrado con la búsqueda o la lectura web. Nunca inventes datos ni completes huecos por intuición.
- Guarda la URL de cada fuente. Cada ficha del CRM («crm__write») lleva sus URLs en «sources».
- Separa siempre: VERIFICADO (lo has visto en una fuente, con su URL), ESTIMADO (deducción tuya, explica el razonamiento) y NO ENCONTRADO.
- Si dos fuentes se contradicen, indícalo y cita ambas.
- No crees contactos personales en el CRM ni guardes emails. Solo fichas de empresa con datos públicos.
- Antes de crear fichas, consulta el CRM («crm__read») para no duplicar.
- Tienes un número limitado de búsquedas: prioriza calidad sobre cantidad (5–8 empresas bien documentadas valen más que 20 dudosas).
- Guarda una ficha comercial por empresa con «content__draft» (kind client_file) o un único informe con todas, y termina con un resumen de lo encontrado.`,
  sofia: `${PILOT_COMMON}

Reglas de estrategia (obligatorias):
- Trabaja con los resultados de Marcus que te llegan en el mensaje y con la memoria. No tienes acceso a internet: no cites fuentes que no aparezcan ahí.
- Separa siempre PREVISIÓN (hipótesis, estimación) de RESULTADO REAL (dato que ya existe en la memoria o en las fichas). Nunca presentes una previsión como resultado.
- Los presupuestos son estimaciones: indica de qué supuestos salen.
- Cualquier campaña o gasto es una propuesta para aprobación; no se ejecuta nada.
- Guarda la estrategia con «content__draft» (kind strategy) y resume las conclusiones en tu respuesta.`,
};

export function pilotSystemPrompt(agent: AgentDefinition): string {
  const guide = PILOT_GUIDES[agent.id];
  return composeSystemPrompt(guide ? `${agent.instructions}\n\n---\n\n${guide}` : agent.instructions);
}

function today(now: Date): string {
  return now.toLocaleDateString("es-ES", { timeZone: "Europe/Madrid", day: "numeric", month: "long", year: "numeric" });
}

const clip = (s: string | null | undefined, n: number) => (!s ? "" : s.length > n ? `${s.slice(0, n)}\n…(recortado)` : s);

function teamSection(children: RelatedTask[], docs: DocumentSummary[], perDoc: number): string {
  return children
    .map((c) => {
      const own = docs.filter((d) => d.task_id === c.id);
      const body =
        c.status === "completed"
          ? `Resultado:\n${clip(c.result, 6000)}`
          : `ESTADO: ${c.status}. Error: ${c.error ?? "sin detalle"}`;
      const attached = own.map((d) => `#### Documento «${d.title}» (${d.kind})\n${clip(d.content, perDoc)}`).join("\n\n");
      return `### ${c.agent_id} · ${c.title} (task_id ${c.id})\n${body}${attached ? `\n\n${attached}` : ""}`;
    })
    .join("\n\n");
}

export interface PromptContext {
  task: TaskRow;
  children: RelatedTask[];
  dependencies: RelatedTask[];
  documents: DocumentSummary[];
  now?: Date;
}

export function initialPrompt(c: PromptContext): string {
  const { task } = c;
  const date = `Fecha de hoy: ${today(c.now ?? new Date())}.`;
  if (task.input.kind === "mission" && task.input.phase === "synthesis") {
    return `${date}\n\nENCARGO DEL ADMINISTRADOR:\n${task.title}\n\n${task.description}\n\nTu plan anterior:\n${clip(task.result, 4000)}\n\nENTREGAS DEL EQUIPO:\n\n${teamSection(c.children, c.documents, 12_000)}\n\nRevisa las entregas. Si falta algo imprescindible y todavía puedes, delega UNA corrección concreta y termina tu turno. Si no, escribe ahora el informe final priorizado (será tu respuesta).`;
  }
  if (task.input.kind === "mission") {
    // Reintento tras un fallo: lo ya delegado no se repite.
    const done = c.children.length
      ? `\n\nSubtareas que ya creaste en un intento anterior (no las repitas):\n${c.children.map((k) => `- ${k.agent_id}: ${k.title} (task_id ${k.id}, ${k.status})`).join("\n")}`
      : "";
    return `${date}\n\nENCARGO DEL ADMINISTRADOR:\n${task.title}\n\n${task.description}${done}\n\nPlanifica y delega en Marcus y Sofia según tus instrucciones.`;
  }
  const deps = c.dependencies.length ? `\n\nRESULTADOS PREVIOS DEL EQUIPO:\n\n${teamSection(c.dependencies, c.documents, 12_000)}` : "";
  return `${date}\n\nTAREA ASIGNADA POR ALEX:\n${task.title}\n\n${task.description}${deps}`;
}
