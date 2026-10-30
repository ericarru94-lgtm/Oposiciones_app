# HE SIGNAL AI OFFICE · Arquitectura

Última actualización: 30/10/2026 (fase 1).

## 1. Análisis del entorno

| Elemento | Situación |
|---|---|
| Repositorio | `ericarru94-lgtm/Oposiciones_app`, carpeta `office/` (la app es independiente de AproBox: su propio `package.json`, sin código compartido) |
| Node | 22 · Next.js 16.4 · React 19.3 · Tailwind 4 · TypeScript 5 |
| Supabase | Proyecto `he-signal-office` (plan Free, Irlanda) creado el 30/10 con migraciones y seed |
| Anthropic | Sin clave configurada (se necesita en la fase 3) |
| n8n | Disponible según el encargo; falta URL y clave de API (fase 5) |
| Hosting | El usuario ya usa Vercel (cuenta personal) |

## 2. Arquitectura

```
Navegador (admin)                     Servidor (Next.js en Vercel)                    Servicios
─────────────────                     ─────────────────────────────                    ─────────
Oficina 3D / lista ──lectura──▶  Server Components + Data Access Layer ──RLS──▶ Supabase Postgres
   ▲  Realtime (estados) ◀───────────────────────────────────────────────────── (tablas + Realtime)
   │                              Server Actions (crear tarea, aprobar…)              ▲
   │                                       │ encola (tabla tasks)                      │ service role
   │                                       ▼                                           │
   │                              Ejecutor de agentes (fase 3) ────────────────────────┘
   │                                 · orquestador (Alex) y 8 especialistas
   │                                 · Anthropic Messages API + Tool Runner ──────▶ Claude
   │                                 · política de permisos → aprobaciones
   │                                 · webhooks firmados ─────────────────────────▶ n8n
```

Principios:
- **La interfaz solo visualiza.** Los estados de los agentes (`agents.status`) los escribe el ejecutor; la oficina 3D y la lista los leen de la base de datos y escuchan Realtime. Nada se anima al azar.
- **La lógica de agentes vive en `src/lib/agents/`**, sin dependencias de React: registro de empleados, catálogo de herramientas, política de permisos e instrucciones.
- **Seguridad en tres capas:** proxy (sesión), servidor (`requireViewer`: email = `ADMIN_EMAIL` + fila en `admins`) y base de datos (RLS: solo `is_admin()`).
- **Claves solo en el servidor.** El navegador recibe únicamente «configurado / pendiente».

### Decisión técnica: cómo se ejecutan los agentes (fase 3)

Se usará la **API de Mensajes de Anthropic con el Tool Runner del SDK oficial** (`@anthropic-ai/sdk`), no el Claude Agent SDK:
- Las herramientas de la oficina son de negocio (memoria, CRM, tareas, aprobaciones, n8n). El Tool Runner permite interceptar **cada llamada** para aplicar `evaluateToolUse()` y crear una aprobación antes de ejecutar nada externo.
- El Claude Agent SDK lleva el arnés de Claude Code (archivos, terminal), que aquí no hace falta y amplía la superficie de riesgo.
- Alternativa futura: Claude Managed Agents (Anthropic aloja el bucle), si se quiere quitar infraestructura.

Cola de trabajos: la propia tabla `tasks` (estado + `for update skip locked`), sin servicio extra. El trabajador se decidirá en la fase 3 (función de Vercel con límite de duración o un pequeño proceso aparte).

### Modelo de datos (Supabase)

`agents` · `tasks` · `task_events` (historial) · `conversations` / `messages` (chats y reuniones) · `memory_items` (memoria global / agente / cliente / proyecto, con origen obligatorio y sin duplicados) · `companies`, `contacts`, `opportunities`, `client_services`, `projects` (CRM, con `source` e `is_demo`) · `approvals` · `activity_log` (solo inserción) · `ai_usage` (coste real) · `settings` · `admins`.

## 3. Servicios y dependencias

| Servicio | Para qué | Cuenta necesaria |
|---|---|---|
| Supabase | Base de datos, login, Realtime | Sí (gratuita para empezar) |
| Anthropic API | Cerebro de los agentes | Sí, con saldo |
| Vercel | Publicar la app | Ya existe |
| n8n | Automatizaciones | Ya disponible |
| Gmail, Metricool, Meta | Acciones externas con aprobación | Más adelante |

Paquetes: `next`, `react`, `@supabase/ssr`, `@supabase/supabase-js`, `zod`; en desarrollo `vitest`, `@electric-sql/pglite` (prueba la migración real con RLS) y `tsx`. Fase 2: `three`, `@react-three/fiber`. Fase 3: `@anthropic-ai/sdk`.

## 4. Costes potenciales (estimados)

| Concepto | Coste |
|---|---|
| Supabase Free | 0 € (se pausa tras 7 días sin uso). Pro: 25 $/mes |
| Vercel Hobby | 0 € · válido porque la oficina es de uso personal del administrador |
| Claude Opus 5.5 | 4 $ / 20 $ por millón de tokens (entrada / salida) |
| Claude Sonnet 5.5 | 2 $ / 10 $ · Claude Haiku 5.5: 0,10 $ / 0,50 $ |
| Búsqueda web de Anthropic | 10 $ por cada 1.000 búsquedas |
| n8n | El que ya tengas (cloud o servidor propio) |

Estimación por uso (a confirmar con datos reales en `ai_usage`): una tarea sencilla de un agente con Opus 5.5 (≈30.000 tokens de entrada y 5.000 de salida) cuesta ≈0,22 $; un encargo completo a Alex con 4–5 agentes y revisión, ≈1–3 $. Con 5 encargos al día, ≈150–450 $/mes. Bajando agentes de apoyo a Sonnet 5.5 el coste se reduce aprox. a la mitad. Habrá límites de gasto mensual y por tarea.

## 5. Plan por fases

1. **Fundamentos** ✅ — proyecto, diseño, esquema de BD con RLS, login de administrador, registro de los 9 agentes, permisos, vista en lista, ficha de empleado, configuración, pruebas.
2. **Oficina 3D** — escena isométrica con React Three Fiber cargada bajo demanda, personajes originales a partir de `AvatarSpec`, escritorios por departamento, sala de reuniones, cámara con zoom, animación según estado real (Realtime), alternativa en lista.
3. **Agentes** — ejecutor con Tool Runner, orquestador (Alex), delegación paralela, revisión por Victoria, chat con cada agente, Kanban, sala de reuniones, reintentos y registro de coste.
4. **Memoria y clientes** — memoria por ámbitos, CRM completo, importación de la hoja de prospección, proyectos.
5. **Automatización** — n8n por API y webhooks firmados (HMAC), entorno de pruebas vs. producción, bandeja de aprobaciones.
6. **Control y analítica** — centro de mando, costes, informes, registro de actividad.
7. **Pruebas y despliegue** — e2e, seguridad, rendimiento, despliegue en Vercel y guía final.
