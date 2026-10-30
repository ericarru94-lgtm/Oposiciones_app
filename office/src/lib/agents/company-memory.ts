// Memoria global inicial de la agencia. Solo datos reales, cada uno con su
// origen. Lo que no se sabe todavía (por ejemplo, las tarifas) se deja
// explícitamente como pendiente en vez de inventarlo.

export interface SeedMemoryItem {
  category: "corporate" | "brand" | "services" | "pricing" | "strategy" | "results" | "decisions";
  title: string;
  content: string;
  source: string;
}

const CONTEXT_FILE = "Oposiciones_app/marketing/CONTEXTO-HE-SIGNAL.md (13/10/2026)";
const MASTER_PROMPT = "Master prompt de HE SIGNAL AI OFFICE (30/10/2026)";

export const GLOBAL_MEMORY: readonly SeedMemoryItem[] = [
  {
    category: "corporate",
    title: "Quiénes somos",
    content:
      "HE Signal Agency es una agencia de Barcelona, en fase inicial de captación de clientes, que trabaja en remoto para toda España. Monta chatbots de WhatsApp e Instagram, asistentes de IA, automatizaciones (n8n), webs con reserva integrada y marketing local. Web: https://hesignalagency.com · Instagram: @hesignalagency · también LinkedIn y WhatsApp Business.",
    source: `${CONTEXT_FILE} · ${MASTER_PROMPT}`,
  },
  {
    category: "corporate",
    title: "Público objetivo",
    content:
      "Prioridad: gimnasios y centros deportivos (boxes, pilates, boutique). También academias (idiomas, repaso, oposiciones) y autoescuelas.",
    source: `${CONTEXT_FILE} · ${MASTER_PROMPT}`,
  },
  {
    category: "services",
    title: "Servicios y oferta actual",
    content:
      "Chatbots de WhatsApp e Instagram, asistentes de IA, automatización de procesos, web con reserva integrada y marketing local. Oferta de captación: auditoría gratuita / sesión de 30 minutos (página /agendar) y 3 plazas piloto con precio de lanzamiento y soporte prioritario el primer mes. Hay demostraciones de chatbots y asistentes de IA.",
    source: `${CONTEXT_FILE} · ${MASTER_PROMPT}`,
  },
  {
    category: "pricing",
    title: "Tarifas",
    content:
      "PENDIENTE: el administrador todavía no ha definido tarifas públicas. No des precios concretos; ofrece la auditoría gratuita y deriva el precio a la propuesta personalizada.",
    source: MASTER_PROMPT,
  },
  {
    category: "brand",
    title: "Identidad de marca",
    content:
      "Color principal naranja #FF4B2B (oscuro #E23B1C, claro #FF8A70), fondo azul marino #10151F, papel #F1F3EE; verde #12B76A solo para el punto de «en línea». Tipografías: Space Grotesk (títulos) e Inter (texto). Logo: monograma «HE» de trazo fino estilo circuito con terminales circulares y un punto naranja con ondas de señal. Eslogan: «IA · CHATBOTS · MARKETING». Tono: agencia joven, cercana y honesta.",
    source: CONTEXT_FILE,
  },
  {
    category: "decisions",
    title: "Reglas de honestidad y contacto",
    content:
      "Nunca inventar clientes, cifras ni testimonios. Contacto comercial uno a uno (DM de Instagram, llamada o en persona); nada de mensajes comerciales masivos por WhatsApp o email (LSSI).",
    source: CONTEXT_FILE,
  },
  {
    category: "results",
    title: "Resultados de Instagram · semana 1 (7–13 oct 2026)",
    content:
      "5 publicaciones (3 reels sin audio a las 08:30 y 19:00 y 2 carruseles): 0 seguidores, 0 comentarios y 0 mensajes. Solo funcionó el reel de «historia con coste» del domingo a las 19:00 («…ya se había apuntado en otro gimnasio»): 110 reproducciones. El resto, entre 1 y 3. Conclusión: cuenta nueva sin alcance; los carruseles no llegan a no seguidores; mejor reels con audio, por la tarde, estilo escena/historia, y sobre todo contacto directo con centros.",
    source: CONTEXT_FILE,
  },
  {
    category: "strategy",
    title: "Estrategia de captación en curso (semana 2)",
    content:
      "Contacto directo con 30 centros independientes de Barcelona (hoja marketing/prospeccion/prospeccion-centros-barcelona.xlsx) con el método «cliente misterioso»: el administrador escribe de noche desde su móvil, anota el tiempo de respuesta y después envía un DM personalizado con el resultado. En paralelo, 3 reels de prueba con audio. La promoción pagada (20–30 € sobre el reel de 110 reproducciones) está aparcada.",
    source: CONTEXT_FILE,
  },
];
