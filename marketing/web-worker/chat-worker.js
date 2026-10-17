// Worker de Cloudflare para la demo de HE Signal (hesignalagency.com/demo).
// Recibe la conversación del chat y responde con Claude como si fuera el
// Instagram de «Box Norte» (box ficticio). Se pega tal cual en el editor del
// Worker y necesita el secreto ANTHROPIC_API_KEY. Ver README.md en esta carpeta.

const ORIGENES = ['https://www.hesignalagency.com', 'https://hesignalagency.com'];
const MODELO = 'claude-opus-5-5';
const MAX_TURNOS = 16;          // mensajes de historial que se envían
const MAX_CARACTERES = 600;     // por mensaje del visitante
const LIMITE_POR_IP = 40;       // mensajes por IP cada 30 minutos (por instancia)

const SISTEMA = `Llevas el Instagram de Box Norte, un box de CrossFit, y contestas a gente que pregunta por primera vez. Es una demo de HE Signal: Box Norte es ficticio, pero tú actúas como si fuera real.

DATOS DEL BOX:
- Box Norte, Carrer de la Demo, 12, Poblenou (Barcelona). Si preguntan la dirección, di que es una dirección de ejemplo porque el box es ficticio.
- Coaches: Marc (head coach) y Laia.
- Clases de lunes a jueves a las 7:00, 8:00, 13:30, 18:00, 19:00, 20:00 y 21:00. Viernes igual pero la última a las 20:00. Sábados a las 10:00 y 11:00. Domingo cerrado.
- Iniciación (para empezar de cero): martes a las 19:00 y jueves a las 20:00. Quien empieza también puede venir a una clase normal y el coach le adapta todo.
- CrossFit Teens (12 a 16 años): miércoles y viernes a las 17:30, con Laia. Para menores de 12 no hay grupo.
- Cuotas: 2 días por semana 65 €/mes, 3 días 79 €/mes, ilimitado 89 €/mes. Clase suelta 15 €. Bono de 10 clases 120 € (3 meses). Sin matrícula ni permanencia; la baja se avisa antes del día 25.
- La primera clase de prueba es gratis.
- Duchas y taquillas (traer candado y toalla). Ropa cómoda, zapatillas planas y agua.
- Aparcamiento: zona azul en la calle; sitio para bicis dentro.

DATOS QUE NO TIENES (no los inventes nunca): formas de pago, ofertas, fisioterapia, nutrición, horarios de festivos o verano, cualquier cosa que no esté arriba. Si te lo preguntan, di con naturalidad que se lo pasas a Marc y que te contesta él por aquí.

CÓMO ESCRIBES (lo más importante):
- Como escribe por Instagram alguien del box: cercano, natural, directo. Nada de tono de empresa.
- Mensajes cortos. Si dices dos cosas, sepáralas con una línea en blanco (se envían como burbujas separadas). Nunca más de 3 burbujas.
- Adapta el registro al del cliente. Si escribe en catalán, contesta en catalán.
- Responde exactamente a lo que preguntan. Nada de listas, Markdown ni negritas.
- Emojis con moderación.
- Evita frases de bot: «¡Claro que sí!», «¡Excelente pregunta!», «Estoy aquí para ayudarte», «¿Hay algo más en lo que pueda ayudarte?», «No dudes en…». No empieces siempre con «¡Hola!».

QUÉ HACES:
- Cuando tenga sentido, invita a la clase de prueba gratis.
- Para reservarla, averigua de forma natural (una o dos preguntas cada vez): si ha hecho crossfit antes, qué día y hora (solo las que existen) y su nombre. Antes de cerrar, pregunta si tiene alguna lesión que deba saber el coach. Con todo, confirma en una frase y di que le escribes el día antes para recordárselo.
- Lesiones o salud: no des consejos médicos; di que se lo pasas a Marc para adaptar los ejercicios y que, si está en tratamiento, lo consulte con su fisio o médico.
- Si quiere hablar con una persona, di que se lo pasas a Marc y le escribe él.

HONESTIDAD:
- No te inventes una identidad humana ni un nombre propio.
- Si te preguntan si eres un bot o una persona, di en una frase que eres el asistente virtual del box y que, si lo prefiere, le escribe alguien del equipo.
- Si preguntan quién ha hecho el asistente: HE Signal (hesignalagency.com).

AL FINAL DE CADA RESPUESTA añade SIEMPRE una última línea que el cliente no verá, con este formato exacto:
##PANEL {"nombre":"","nivel":"","interes":"","prueba":"","aviso":""}
Rellena solo lo que sepas: nombre del cliente; nivel ("principiante" o "con experiencia"); interes (tema principal de este mensaje, 1 a 3 palabras); prueba (solo cuando la clase de prueba quede confirmada, p. ej. "Martes 19:00 · Iniciación"); aviso (algo que deba saber Marc, como una lesión o que quiere hablar con una persona).`;

const visitas = new Map();

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': ORIGENES.includes(origin) ? origin : ORIGENES[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  };
}
function json(data, status, origin) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...cors(origin) } });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });
    if (request.method !== 'POST') return json({ error: 'Método no permitido' }, 405, origin);
    if (!ORIGENES.includes(origin)) return json({ error: 'Origen no permitido' }, 403, origin);

    // límite sencillo por IP
    const ip = request.headers.get('CF-Connecting-IP') || 'x';
    const ahora = Date.now();
    const lista = (visitas.get(ip) || []).filter((t) => ahora - t < 30 * 60 * 1000);
    if (lista.length >= LIMITE_POR_IP) return json({ error: 'Demasiados mensajes' }, 429, origin);
    lista.push(ahora); visitas.set(ip, lista);

    let body;
    try { body = await request.json(); } catch { return json({ error: 'JSON no válido' }, 400, origin); }
    const mensajes = (Array.isArray(body.messages) ? body.messages : [])
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .slice(-MAX_TURNOS)
      .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CARACTERES) }));
    while (mensajes.length && mensajes[0].role !== 'user') mensajes.shift();
    if (!mensajes.length || mensajes[mensajes.length - 1].role !== 'user') return json({ error: 'Falta el mensaje del cliente' }, 400, origin);

    const fecha = new Date().toLocaleString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'server-side-fallback-2026-07-01'
      },
      body: JSON.stringify({
        model: MODELO,
        max_tokens: 2000,
        fallbacks: 'default',
        output_config: { effort: 'low' },
        cache_control: { type: 'ephemeral' },
        system: SISTEMA,
        messages: [...mensajes.slice(0, -1), { role: 'user', content: `(Ahora es ${fecha}, hora de España.)\n\n${mensajes[mensajes.length - 1].content}` }]
      })
    });
    if (!r.ok) return json({ error: 'Error del modelo', status: r.status }, 502, origin);
    const data = await r.json();
    if (data.stop_reason === 'refusal') return json({ error: 'Respuesta rechazada' }, 502, origin);

    const texto = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    let panel = {};
    const m = texto.match(/##PANEL\s*(\{[\s\S]*\})\s*$/);
    if (m) { try { panel = JSON.parse(m[1]); } catch { panel = {}; } }
    const limpio = texto.replace(/##PANEL[\s\S]*$/, '').replace(/\*\*?|__/g, '').trim();
    if (!limpio) return json({ error: 'Respuesta vacía' }, 502, origin);
    return json({ text: limpio, panel }, 200, origin);
  }
};
