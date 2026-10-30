# Auditoría técnica de la fase 1 y preparación de la fase 2

Fecha: 30/10/2026 · Alcance: solo `office/`. Revisión hecha sobre el código real (migraciones, proxy, sesión, acciones, páginas, tests).

## 1. Problemas encontrados (por criticidad)

| # | Criticidad | Problema | Estado |
|---|---|---|---|
| 1 | **Alta** | El administrador podía escribir desde el navegador en `approvals`, `ai_usage` y `task_events` (política «acceso completo»). Con su sesión se podía marcar una aprobación como aprobada sin pasar por ningún control, falsear costes o el historial. | Corregido: solo lectura; las aprobaciones se deciden con `decide_approval()` |
| 2 | **Alta** | Las aprobaciones no estaban ligadas a los argumentos: no había huella, caducidad ni uso único. Una aprobación podía reutilizarse o aplicarse a otro contenido. | Corregido: huella SHA-256, caducidad, un solo uso, inmutables |
| 3 | **Alta** | No existía una puerta única de ejecución de herramientas: nada impedía, por diseño, llamar a una herramienta saltándose los permisos. | Corregido: `ToolGateway` (manejadores privados, permisos y aprobación obligatorios) |
| 4 | Media | El administrador podía cambiar `agents.status` y el estado de las tareas: la oficina podría mostrar estados que no vienen del motor. | Corregido: permisos por columna; los estados solo los cambia el motor |
| 5 | Media | `activity_log` permitía insertar con cualquier `actor_id`. | Corregido: el autor debe ser el propio usuario |
| 6 | Media | Sin protección contra tareas duplicadas ni motor de ejecución (leases, reintentos, recuperación, tiempos). | Corregido: ver §3 |
| 7 | Media | Inicio de sesión sin límite de intentos propio. Supabase Auth limita por IP, pero todas las peticiones salen del servidor de Vercel. | **Pendiente** (ver §6) |
| 8 | Media | Límites de gasto solo en variables de entorno, sin aplicarse en ningún sitio. | Corregido: en `settings`, aplicados por el motor y editables en Configuración |
| 9 | Baja | Las páginas «en construcción» no llamaban a `requireViewer()` (el layout sí). | Corregido + prueba que lo exige en todas |
| 10 | Baja | Sin cabeceras de seguridad (clickjacking, MIME sniffing, HSTS). | Corregido en `next.config.ts` |
| 11 | Baja | El proxy trataba como pública cualquier ruta que empezara por `/auth` o `/login…`. | Corregido: solo `/login` exacto |
| 12 | Baja | Memoria sin historial de versiones y sin separación de clientes al leerla un agente. | Corregido: versiones automáticas y `memory_for_task()` |
| 13 | Info | `is_admin()` es SECURITY DEFINER ejecutable por usuarios con sesión (aviso del asesor de Supabase). Es necesario para RLS y solo responde sí/no sobre el propio usuario. | Aceptado |

Revisado sin problemas: `search_path` fijo en todas las funciones (ahora lo comprueba un test), `is_admin()` sin parámetros, `private.link_admin()` sin permisos de ejecución, claves solo en servidor (test estático), `.env.local` fuera de Git, `getUser()` validado contra Supabase en el servidor, Server Actions con comprobación de origen de Next.js.

## 2. Aprobaciones (migración 0004)

Cada aprobación guarda: agente, herramienta (`tool_id`), acción exacta (`action`), argumentos completos (`arguments`), huella `args_hash` = SHA-256 del JSON normalizado, ejecución (`run_id`) y llamada de Claude (`tool_use_id`), creación, caducidad (`expires_at`, 72 h por defecto, máx. 7 días), estado, quién decide (`decided_by`) y cuándo se usa (`consumed_at`).

- Toda aprobación **nace pendiente** (un trigger lo fuerza) y es **inmutable**: si cambian los argumentos hay que pedir otra.
- Solo el administrador decide, con `decide_approval()` (comprueba `is_admin()`, registra la actividad y reanuda la tarea).
- El motor la usa con `consume_approval()`, que exige estado aprobado, no caducada, no usada, misma ejecución, herramienta, acción y **misma huella**; la marca como usada en la misma sentencia (**un solo uso**).
- Idempotencia: `unique (run_id, tool_use_id)`; una misma llamada de Claude no genera dos aprobaciones.
- Puerta única en código (`src/lib/engine/gateway.ts`): los manejadores son privados de `ToolGateway`; `execute()` aplica permisos, disponibilidad real y aprobación antes de ejecutar nada.

## 3. Motor de ejecución

Tabla `tasks` ampliada (`idempotency_key` única, `run_after`, `locked_by/locked_until` (lease), `heartbeat_at`, `timeout_seconds`), nueva `task_dependencies` (sin ciclos) y nueva **`agent_runs`** (una fila por ejecución: intento, estado, pasos, recuperaciones, tokens, coste, conversación guardada, aprobación pendiente, error).

Funciones (solo `service_role`): `claim_next_task` (`FOR UPDATE SKIP LOCKED`; presupuesto, concurrencia global, una tarea por agente, dependencias, esperas, intentos, tiempo máximo), `heartbeat_run`, `record_step` (consumo + coste + estado; devuelve si se puede continuar), `request_approval`, `pause_for_approval`, `complete_run` (pasa a revisión si hace falta), `fail_run` (reintento con espera 30 s, 60 s, 120 s… o fallo), `record_review`, `recover_stale` (caduca aprobaciones y corta tareas que superan su tiempo). Todas comprueban que el trabajador sigue siendo dueño del lease.

**Bucle manual** (`src/lib/engine/loop.ts`): un paso = como mucho una llamada a Claude. Pide al modelo → identifica herramientas → evalúa permisos → pide aprobación si toca → ejecuta solo lo permitido → devuelve todos los resultados en un único mensaje → guarda el estado. Si una acción necesita aprobación, la ejecución **se pausa sin ocupar ningún proceso** y se reanuda al decidir; si la rechazas, Claude recibe el motivo y no se ejecuta nada. Los bloques de pensamiento se guardan intactos (Opus/Sonnet 5.5 lo exigen). Se clasifican `refusal` (no reintentar), `max_tokens` y errores de red (reintentables).

### Límites reales de la infraestructura gratuita

| Servicio | Límite relevante | Fuente |
|---|---|---|
| Vercel Hobby | Funciones: 300 s por defecto y máximo; 2 GB / 1 vCPU; cuerpo de petición 4,5 MB | vercel.com/docs/functions/limitations |
| Vercel Hobby | Cron: solo **una vez al día**, precisión ±59 min | vercel.com/docs/cron-jobs/usage-and-pricing |
| Supabase Free | 500 MB de base de datos (pasa a solo lectura), 1 GB de Storage, 5 GB de egress, 200 conexiones Realtime, 2 M mensajes Realtime, 500.000 invocaciones de Edge Functions | supabase.com/docs/guides/platform/billing-on-supabase |
| Supabase Free | Se pausa tras 7 días con poca actividad; se restaura en 90 días | supabase.com/docs/guides/platform/free-project-pausing |
| Supabase | `pg_cron` + `pg_net` disponibles: pueden llamar a una URL cada minuto | supabase.com/docs/guides/functions/schedule-functions |

**Consecuencias:** una tarea larga no cabe en una sola función de 300 s y el cron de Vercel Hobby no sirve para despertar al motor. Diseño elegido sin infraestructura extra: cada invocación ejecuta pasos cortos con lease de 240 s (`claim_next_task` exige < 290 s) y guarda el estado; el «latido» lo dan `pg_cron` + `pg_net` en Supabase (cada minuto, llamada firmada a `/api/engine/tick`) y la propia oficina al crear una tarea o aprobar una acción. Limitación aceptada: hasta ~1 min de espera entre pasos cuando nadie tiene la oficina abierta. Si en el futuro hiciera falta más continuidad, un trabajador siempre encendido (un servicio pequeño de pago) es la evolución natural; no se incorpora ahora.

## 4. Documentos y entregables

Tabla `documents` (informe, estrategia, propuesta, PDF, presentación, guion, creatividad, archivo de cliente, documentación técnica, otro) vinculada a tarea, ejecución, agente, proyecto y cliente; contenido en Markdown o archivo; versión y versión anterior; huella; origen obligatorio; `is_demo`. Bucket de Storage **privado** `documents` (máx. 50 MB por archivo, tipos permitidos), con política solo para el administrador.

## 5. Memoria y CRM

- Separación por cliente: `memory_for_task()` devuelve la memoria global, la del agente y **solo** la del cliente/proyecto de esa tarea.
- Historial: cada cambio guarda la versión anterior en `memory_item_versions` (no se puede escribir a mano). Las decisiones (`category = 'decisions'`) conservan así su historial.
- Duplicados: índices únicos en memoria (ámbito + título), empresas (nombre + ciudad), contactos (empresa + email) y tareas (clave de idempotencia).
- Origen: `source` obligatorio en memoria, empresas, contactos y documentos.
- Dependencias entre tareas: `task_dependencies` sin ciclos; una tarea no empieza hasta que terminan aquellas de las que depende.

## 6. Pendiente (no corregido en esta revisión)

1. **Límite de intentos de inicio de sesión** propio (p. ej. tabla de intentos por email + bloqueo temporal) o CAPTCHA de Supabase. Mitigado por contraseña larga y una única cuenta.
2. **Política de contraseñas y MFA** en Supabase Auth (longitud mínima, TOTP). Se configura en el panel; no es accesible desde aquí.
3. **Content-Security-Policy** con nonce (requiere ajustar los scripts de Next.js; se hará con la fase 2, cuando entren Three.js y Realtime).
4. Verificar en el panel que «Allow new users to sign up» está desactivado (lo confirmaste; no puedo leer esa opción con la conexión actual).

## 7. Costes de Anthropic (precios oficiales)

| Modelo | Entrada | Salida | Lectura de caché | Notas |
|---|---|---|---|---|
| Claude Opus 5.5 | 4 $/M | 20 $/M | 0,20 $/M | escritura de caché 1,25× |
| Claude Sonnet 5.5 | 2 $/M | 10 $/M | 0,20 $/M | |
| Claude Haiku 5.5 | 0,10 $/M | 0,50 $/M | ≈0,01 $/M (estimado) | 0,50/2,50 $ si el prompt supera 100.000 tokens |
| Búsqueda web | 10 $ por 1.000 búsquedas | | | |

Estimación revisada (más prudente que la anterior porque cuenta que cada paso reenvía la conversación): una tarea típica de ~6 pasos ≈ 90.000 tokens de entrada (70 % desde caché) y 6.000 de salida. Coste por tarea ≈ 0,29 $ (Opus), 0,15 $ (Sonnet), 0,008 $ (Haiku). Un encargo a Alex ≈ 6 tareas.

| Encargos al mes | Todo Opus | Todo Sonnet | Todo Haiku | Mixto recomendado* |
|---|---|---|---|---|
| 20 | ~35 $ | ~18 $ | ~1 $ | ~7 $ |
| 60 | ~105 $ | ~54 $ | ~3 $ | ~20 $ |
| 150 | ~260 $ | ~135 $ | ~7 $ | ~50 $ |

\* Alex y Victoria con Sonnet 5.5, el resto con Haiku 5.5. Más búsquedas web (~0,10 $ por encargo). Son estimaciones: las cifras reales quedarán en `ai_usage` (por llamada), `agent_runs` (por ejecución) y las vistas `ai_cost_monthly` y `agent_run_stats_monthly` (por agente y mes: tokens, coste, tareas, errores, consumo medio). Los límites mensual y por tarea paran el motor de forma automática.

## 8. Pruebas

74 pruebas en verde (`npm run check`): seguridad de funciones (solo `service_role` ejecuta el motor; solo 4 SECURITY DEFINER, todas con `search_path`), RLS en todas las tablas, escrituras prohibidas desde el navegador, aprobaciones (huella, un solo uso, inmutables, caducidad, idempotencia, solo admin), motor (concurrencia, dependencias, leases, recuperación, reintentos, tiempo máximo, revisión, presupuesto), memoria versionada y aislada por cliente, documentos privados, puerta de herramientas y bucle con modelo simulado, costes, y comprobaciones estáticas (requireViewer en todas las páginas y acciones, claves solo en servidor, cabeceras). Compilación de producción correcta y prueba en navegador (escritorio y móvil, sin errores ni desbordes).
