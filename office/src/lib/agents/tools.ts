// Catálogo de herramientas que pueden tener los agentes.
//
// Cada herramienta declara su nivel de riesgo. El riesgo decide si la acción
// se ejecuta directamente o si se crea una solicitud de aprobación para el
// administrador (ver permissions.ts). La disponibilidad indica si la
// herramienta ya está conectada: un agente nunca debe fingir que ha usado una
// herramienta que no está disponible.

export const TOOL_RISKS = [
  "read", //               leer datos internos o públicos
  "internal_write", //     crear borradores, notas, tareas, fichas del CRM
  "external_action", //    contactar, enviar o publicar fuera de la oficina
  "spend", //              gastar dinero
  "production_change", //  tocar automatizaciones o sistemas en producción
  "destructive", //        borrar información o cambios irreversibles
] as const;
export type ToolRisk = (typeof TOOL_RISKS)[number];

export type ToolAvailability =
  | { state: "planned"; phase: number } // se implementa en esa fase
  | { state: "needs_integration"; integration: string } // falta conectar un servicio externo
  | { state: "available" };

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  risk: ToolRisk;
  availability: ToolAvailability;
  /** Coste aproximado aparte de los tokens del modelo, si lo hay. */
  extraCost?: string;
}

export const TOOLS = {
  "memory.read": {
    id: "memory.read",
    name: "Leer memoria",
    description: "Consulta la memoria global, la propia del agente y la de clientes y proyectos.",
    risk: "read",
    availability: { state: "planned", phase: 3 },
  },
  "memory.write": {
    id: "memory.write",
    name: "Guardar en memoria",
    description: "Guarda decisiones, resultados y aprendizajes con referencia a su origen.",
    risk: "internal_write",
    availability: { state: "planned", phase: 4 },
  },
  "tasks.delegate": {
    id: "tasks.delegate",
    name: "Delegar tareas",
    description: "Crea subtareas y las asigna a otros empleados.",
    risk: "internal_write",
    availability: { state: "planned", phase: 3 },
  },
  "tasks.request_review": {
    id: "tasks.request_review",
    name: "Pedir revisión",
    description: "Envía un entregable a control de calidad.",
    risk: "internal_write",
    availability: { state: "planned", phase: 3 },
  },
  "tasks.report": {
    id: "tasks.report",
    name: "Entregar resultado",
    description: "Entrega el resultado de una tarea al director o al administrador.",
    risk: "internal_write",
    availability: { state: "planned", phase: 3 },
  },
  "web.search": {
    id: "web.search",
    name: "Buscar en internet",
    description: "Búsqueda web con citas de las fuentes (herramienta oficial de Anthropic).",
    risk: "read",
    availability: { state: "planned", phase: 3 },
    extraCost: "10 $ por cada 1.000 búsquedas",
  },
  "web.fetch": {
    id: "web.fetch",
    name: "Leer una web",
    description: "Lee el contenido de una URL concreta (webs de posibles clientes, competencia).",
    risk: "read",
    availability: { state: "planned", phase: 3 },
  },
  "crm.read": {
    id: "crm.read",
    name: "Consultar CRM",
    description: "Lee empresas, contactos, oportunidades y seguimientos.",
    risk: "read",
    availability: { state: "planned", phase: 4 },
  },
  "crm.write": {
    id: "crm.write",
    name: "Actualizar CRM",
    description: "Crea o actualiza fichas del CRM. Debe indicar la fuente de cada dato.",
    risk: "internal_write",
    availability: { state: "planned", phase: 4 },
  },
  "content.draft": {
    id: "content.draft",
    name: "Crear borrador",
    description: "Guarda textos, guiones, propuestas o briefs como borrador revisable.",
    risk: "internal_write",
    availability: { state: "planned", phase: 3 },
  },
  "quality.review": {
    id: "quality.review",
    name: "Revisar entregable",
    description: "Aprueba o devuelve un entregable con observaciones.",
    risk: "internal_write",
    availability: { state: "planned", phase: 3 },
  },
  "costs.read": {
    id: "costs.read",
    name: "Consultar costes",
    description: "Lee el consumo real de IA y herramientas registrado en la base de datos.",
    risk: "read",
    availability: { state: "planned", phase: 6 },
  },
  "analytics.read": {
    id: "analytics.read",
    name: "Leer métricas",
    description: "Métricas reales de Instagram y campañas.",
    risk: "read",
    availability: { state: "needs_integration", integration: "Metricool / Meta" },
  },
  "n8n.read": {
    id: "n8n.read",
    name: "Ver workflows de n8n",
    description: "Lista y lee workflows y ejecuciones de n8n.",
    risk: "read",
    availability: { state: "planned", phase: 5 },
  },
  "n8n.test": {
    id: "n8n.test",
    name: "Probar workflow (entorno de pruebas)",
    description: "Lanza un webhook de pruebas de n8n, nunca uno de producción.",
    risk: "internal_write",
    availability: { state: "planned", phase: 5 },
  },
  "n8n.production": {
    id: "n8n.production",
    name: "Modificar o activar en producción",
    description: "Crea, cambia o activa workflows de producción en n8n.",
    risk: "production_change",
    availability: { state: "planned", phase: 5 },
  },
  "email.send": {
    id: "email.send",
    name: "Enviar email",
    description: "Envía un email desde la cuenta de la agencia.",
    risk: "external_action",
    availability: { state: "needs_integration", integration: "Gmail de la agencia" },
  },
  "outreach.contact": {
    id: "outreach.contact",
    name: "Contactar con una empresa",
    description: "Envía un DM, mensaje o propuesta a un posible cliente.",
    risk: "external_action",
    availability: { state: "needs_integration", integration: "Instagram / WhatsApp Business" },
  },
  "social.publish": {
    id: "social.publish",
    name: "Publicar contenido",
    description: "Programa o publica en redes sociales.",
    risk: "external_action",
    availability: { state: "needs_integration", integration: "Metricool" },
  },
  "ads.launch": {
    id: "ads.launch",
    name: "Lanzar campaña de pago",
    description: "Crea o activa anuncios con presupuesto.",
    risk: "spend",
    availability: { state: "needs_integration", integration: "Meta Ads / Google Ads" },
  },
  "media.generate": {
    id: "media.generate",
    name: "Generar imagen o vídeo",
    description: "Crea imágenes o vídeos con herramientas de IA externas.",
    risk: "spend",
    availability: { state: "needs_integration", integration: "Generador de imagen/vídeo" },
  },
  "data.delete": {
    id: "data.delete",
    name: "Eliminar información",
    description: "Borra registros de la oficina.",
    risk: "destructive",
    availability: { state: "planned", phase: 4 },
  },
} as const satisfies Record<string, ToolDefinition>;

export type ToolId = keyof typeof TOOLS;
export const TOOL_IDS = Object.keys(TOOLS) as ToolId[];

export function getTool(id: ToolId): ToolDefinition {
  return TOOLS[id];
}

export function isToolId(id: string): id is ToolId {
  return Object.hasOwn(TOOLS, id);
}

export function availabilityLabel(a: ToolAvailability): string {
  switch (a.state) {
    case "available":
      return "Disponible";
    case "planned":
      return `Se activa en la fase ${a.phase}`;
    case "needs_integration":
      return `Falta conectar: ${a.integration}`;
  }
}
