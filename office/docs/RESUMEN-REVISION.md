# HE SIGNAL AI OFFICE · Resumen para revisión externa (fase 1)

Fecha: 30/10/2026. Código: repositorio `ericarru94-lgtm/Oposiciones_app`, carpeta `office/`, rama `ccr-30b91845-834xuv`.

## Objetivo del producto
Oficina virtual de uso personal (un solo administrador) para dirigir la agencia HE Signal con 9 empleados de IA: Alex (CEO/orquestador), Marcus (comercial y CRM), Sofia (marketing), Daniel (contenidos), Lucia (creatividad), David (automatización/n8n), Emma (clientes), Oscar (datos y costes) y Victoria (control de calidad). Pantalla principal: oficina 3D isométrica (fase 2) con alternativa en lista. Los agentes harán trabajo real con la API de Claude (fase 3) y toda acción externa requiere aprobación humana.

## Plan por fases
1. Fundamentos ✅ · 2. Oficina 3D · 3. Agentes y orquestador · 4. Memoria y CRM · 5. n8n y aprobaciones · 6. Centro de mando y costes · 7. Pruebas y despliegue.

## Stack
- Next.js 16.4 (App Router, `proxy.ts` en lugar de middleware), React 19.3, TypeScript 5, Tailwind 4.
- Supabase (PostgreSQL, Auth, Realtime, RLS), proyecto en plan Free (Irlanda).
- Fase 2: three.js + React Three Fiber. Fase 3: `@anthropic-ai/sdk` (Messages API + Tool Runner).
- Pruebas: Vitest + PGlite (PostgreSQL embebido que ejecuta las migraciones reales).
- Hosting: Vercel Hobby (uso personal).

## Decisiones de arquitectura
1. **La interfaz solo visualiza.** El estado de cada agente (`agents.status`) lo escribirá el ejecutor del servidor; la UI lo lee y escucha Realtime. Nada se anima al azar.
2. **Lógica de agentes separada de la UI** en `src/lib/agents/` (registro, herramientas, permisos, prompts), sin dependencias de React.
3. **Agentes con Messages API + Tool Runner** en vez de Claude Agent SDK: las herramientas son de negocio (memoria, CRM, tareas, n8n) y el Tool Runner permite interceptar cada llamada para aplicar permisos y crear aprobaciones. El Agent SDK trae acceso a archivos y terminal, innecesario y más arriesgado aquí.
4. **Cola de trabajos en la propia tabla `tasks`** (estado + `for update skip locked`), sin servicio extra.
5. **Fuente de verdad de los agentes en código** (`registry.ts`); un script genera `supabase/seed.sql` idempotente que no pisa el estado en tiempo real ni el modelo elegido.

## Seguridad
- **Tres capas:** (a) `proxy.ts` refresca la sesión de Supabase y redirige al login; (b) en el servidor, `requireViewer()` exige email = `ADMIN_EMAIL` **y** fila en `public.admins`; (c) RLS en todas las tablas: solo `is_admin()`.
- **Alta del administrador:** lista privada `private.admin_allowlist` (esquema no expuesto) + trigger en `auth.users` que añade a `public.admins` solo los emails permitidos. Un usuario no puede darse de alta como admin.
- **Registro de actividad inalterable:** `activity_log` solo admite select/insert; update/delete/truncate revocados; el admin no puede insertar como agente.
- **Claves solo en servidor:** la UI solo recibe «configurado / pendiente». La clave secreta de Supabase solo se usa en el servidor.
- **Vista previa sin base de datos** (`LOCAL_PREVIEW=1`) imposible en producción.
- Asesor de seguridad de Supabase: un aviso intencionado (`is_admin()` ejecutable por usuarios con sesión, necesario para RLS; solo devuelve si el propio usuario es admin).
- Comprobado en la base de datos real: un visitante anónimo y un usuario no admin ven 0 filas.

## Permisos de los agentes
- Cada herramienta tiene nivel de riesgo: `read`, `internal_write`, `external_action`, `spend`, `production_change`, `destructive`.
- Los cuatro últimos **siempre** requieren aprobación humana (enviar emails, contactar, publicar, campañas, gastar, tocar producción, borrar).
- `evaluateToolUse(agente, herramienta)` devuelve `allow`, `needs_approval`, `denied` (el agente no tiene ese permiso) o `unavailable` (herramienta aún no conectada; el agente debe decirlo, no simular).
- Solo Alex puede delegar tareas. Victoria y Alex pueden revisar calidad.
- Todos los prompts incluyen reglas comunes: no inventar datos ni clientes, no simular acciones, pedir aprobación, cumplir LSSI/RGPD, citar la fuente.

## Modelo de datos (Supabase)
`agents`, `tasks` (estados: pending → assigned → in_progress → in_review → needs_approval → completed / failed; reintentos limitados; si `requires_review`, no se completa sin revisión aprobada), `task_events` (historial), `conversations`/`messages` (chats y reuniones), `memory_items` (ámbitos global/agente/cliente/proyecto, origen obligatorio, índice único contra duplicados, restricción de coherencia de ámbito), CRM (`companies`, `contacts` con base legal de contacto, `opportunities`, `client_services`, `projects`, todos con `source` e `is_demo`), `approvals`, `activity_log`, `ai_usage` (tokens y coste real), `settings`, `admins`.

Memoria inicial: 8 entradas reales sobre la agencia, cada una con su origen; las tarifas quedan como «PENDIENTE» en vez de inventarlas.

## Interfaz construida (fase 1)
- Login de administrador (email + contraseña, mensaje de error genérico).
- Oficina en vista lista: 9 tarjetas con avatar original en SVG, estado, departamento, tarea actual y contadores.
- Ficha de empleado: puesto, responsabilidades, tarea actual, pendientes, completadas, historial, modelo, herramientas con riesgo y disponibilidad, instrucciones completas. Botones «Conversar» y «Asignar tarea» desactivados hasta la fase 3.
- Configuración: estado de integraciones, modelo por agente con precios, límites de gasto, acciones que requieren aprobación.
- Secciones de fases futuras marcadas como «no construida», sin datos simulados.
- Paleta: negro, blanco y azul cobalto #2747F5, con el naranja de la marca #FF4B2B como detalle. Space Grotesk + Inter. Responsive (comprobado a 390 px sin scroll horizontal).

## Pruebas (30, todas en verde) y verificación
- Registro: 9 agentes, ids y escritorios únicos, herramientas válidas, solo Alex coordina, prompts con reglas comunes, seed sincronizado.
- Permisos: riesgos que requieren aprobación, denegación, herramientas no disponibles.
- Máquina de estados de tareas: transiciones válidas, control de calidad obligatorio, límite de reintentos.
- Base de datos (migraciones reales en PGlite): seed idempotente, memoria sin duplicados, RLS para admin / otro usuario, alta de admin solo por lista, registro inalterable, aprobaciones coherentes.
- Entorno: modos de autenticación, claves nunca expuestas, validación de límites.
- `next build` sin errores; todas las rutas privadas son dinámicas (nunca prerenderizadas). Prueba en navegador real (escritorio y móvil) con Playwright.

## Limitaciones conocidas
- El inicio de sesión completo no se ha probado de principio a fin porque el entorno de desarrollo no tiene red hacia supabase.co; la seguridad se verificó dentro de la base de datos real y con PGlite.
- Falta crear la cuenta del administrador en Supabase Auth y desactivar los registros públicos.
- Supabase Free pausa el proyecto tras 7 días sin uso.
- La API de Claude no es gratuita (pago por uso). Habrá límites de gasto mensual y por tarea.

## Preguntas para la revisión
1. ¿Ves algún hueco de seguridad en el modelo de tres capas o en las políticas RLS?
2. ¿El modelo de datos cubre bien memoria, CRM y aprobaciones para crecer?
3. ¿La decisión Messages API + Tool Runner frente a Claude Agent SDK es razonable para este caso?
4. ¿Qué cambiarías antes de construir la oficina 3D y el orquestador?
