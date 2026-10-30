# Auditoría final de seguridad · antes de conectar Claude

Fecha: 30/10/2026 · Producción: https://he-signal-office.vercel.app (commit `c106f4e`) · Supabase `bgptbtmyhtobqohkoeyd`.
Durante esta auditoría **no se ha modificado producción**: solo consultas de lectura. Las correcciones están en el repositorio (migración `0005`) pendientes de tu autorización para aplicarlas.

## 1. Pruebas ejecutadas

| Ámbito | Cómo | Resultado |
|---|---|---|
| Permisos reales de producción | Consultas `has_table_privilege` / `has_function_privilege` sobre todas las tablas, vistas y funciones de Supabase real | Ver §2 (hallazgos) |
| Funciones SECURITY DEFINER | Lista real: `is_admin`, `decide_approval`, `link_admin`, `memory_items_versioning`; todas con `search_path=""` | Correcto |
| Motor solo para service_role | 13 funciones del motor sin EXECUTE para PUBLIC/anon/authenticated (producción) | Correcto |
| Variables de Vercel | Solo `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `ADMIN_EMAIL`, `DEFAULT_AGENT_MODEL`; ninguna secreta | Correcto |
| Código que llega al navegador | Búsqueda en `.next/static` de `sb_secret`, `SUPABASE_SECRET_KEY`, `ANTHROPIC_API_KEY`, `sk-ant` | 0 coincidencias |
| `approvals.payload` | Búsqueda en todo el repositorio + datos de producción | Solo aparece en la definición de 0001; 0 filas con datos; ningún código la usa |
| Aprobaciones (PGlite) | Válida, caducada, reutilizada, argumentos cambiados, otro `run_id`, otra herramienta, otra acción, sin lease | Ninguna acción no autorizada se ejecuta |
| Concurrencia (**PostgreSQL 18 real**, varias conexiones) | 2 consumos simultáneos de la misma aprobación; 10 inicios de ejecución en paralelo; 8 trabajadores a la vez | Solo 1 consumo, 1 ejecución; ninguna tarea duplicada |
| Idempotencia | Corte del proceso tras ejecutar la acción y antes de guardar el resultado; reintento tras completar | No se repite; el primero queda «incierto» para revisión humana; el segundo devuelve el resultado guardado |
| Aislamiento entre clientes | `memory_for_task` y `documents_for_task` | Un agente solo recibe datos del cliente de su tarea |
| Cliente real de Claude | Peticiones simuladas sin red (fetch falso) | Respaldo de seguridad en Opus/Sonnet, caché, consumo completo, errores bien clasificados |
| Conjunto completo | `npm run check` + `next build` | **95 pruebas en verde** (9 ficheros), compilación correcta |

## 2. Problemas encontrados

| # | Gravedad | Problema | Estado |
|---|---|---|---|
| A | Media | En producción `anon` y `authenticated` conservan los privilegios por defecto de Supabase: `ALL` en casi todas las tablas, incluidos **TRUNCATE** (que ignora RLS), REFERENCES y TRIGGER. RLS bloquea SELECT/INSERT/UPDATE/DELETE y la API REST no permite TRUNCATE, así que **no es explotable desde fuera**, pero rompe el principio de mínimo privilegio. | Corregido en `0005` (pendiente de aplicar) |
| B | Media | Sin registro previo de acciones con efectos: si el proceso se cortaba tras enviar un email y antes de guardarlo, un reintento podía volver a intentarlo (la aprobación de un solo uso lo frenaba, pero el agente no sabía qué había pasado). | Corregido: `tool_executions` + `begin/finish_tool_execution` (en `0005`) y puerta de herramientas actualizada |
| C | Baja | El alta automática del administrador se disparaba al crear el usuario, aunque el email no estuviera confirmado. | Corregido en `0005`: exige email confirmado |
| D | Baja | `admins`, `agent_runs`, `memory_item_versions` y las vistas de costes tenían privilegios de escritura para `authenticated` (bloqueados por RLS). | Corregido en `0005` |
| E | Baja | `approvals.payload` sin uso pero escribible. | Corregido en `0005`: restricción que la obliga a estar vacía |
| F | Baja | Faltaba una vía aislada por cliente para que los agentes lean documentos. | Corregido: `documents_for_task()` |
| G | Info | Supabase recomienda activar la protección de contraseñas filtradas. | Pendiente (panel de Supabase) |

Sin problemas: ninguna función SECURITY DEFINER permite escalar privilegios (`is_admin` sin parámetros; `decide_approval` comprueba `is_admin()` y solo cambia aprobaciones pendientes y no caducadas; los triggers no son invocables directamente); claves secretas solo en servidor; todas las operaciones sensibles pasan por funciones del motor (service_role) o por Server Actions con `requireViewer()`.

## 3. Idempotencia de acciones externas

Flujo: `begin_tool_execution` (en una transacción: comprueba si esa llamada de Claude ya se ejecutó, consume la aprobación y registra la ejecución como `started`) → el proveedor ejecuta la acción → `finish_tool_execution` guarda resultado e identificador del proveedor.

| Caso | Comportamiento |
|---|---|
| Reintento de una llamada ya completada | Devuelve el resultado guardado; no se repite |
| Corte entre la acción y el guardado | La ejecución pasa a `unknown`; Claude recibe «resultado incierto»; **no se repite**; el administrador verifica |
| Otra llamada con la misma aprobación | Denegada (un solo uso) |

Limitaciones por proveedor (para cuando se conecten):

| Proveedor | ¿Clave de idempotencia nativa? | Cómo se verificará un caso «incierto» |
|---|---|---|
| Gmail API | No | Se envía con cabecera `Message-ID` = id de la ejecución y se busca en «Enviados» antes de reintentar |
| Metricool | No (según su API pública) | Listar publicaciones programadas y buscar la marca de la ejecución en el texto interno |
| Instagram / WhatsApp (DM) | No | Verificación manual en la conversación |
| Meta Ads / Google Ads | No en la creación | Nombre de campaña con el id de la ejecución y búsqueda antes de reintentar; nacen en pausa |
| n8n (webhooks) | No incorporada | Se envía `X-Idempotency-Key`; cada workflow debe deduplicar con un Data Store |

## 4. No verificable directamente en producción

1. Inicio de sesión real de principio a fin (el entorno de pruebas no tiene red hacia supabase.co ni vercel.app).
2. Configuración de Supabase Auth: registros desactivados, política de contraseñas, MFA (no accesibles con la conexión actual; confirmaste los registros).
3. Concurrencia sobre la instancia real de Supabase (probada en PostgreSQL 18 real local con las mismas migraciones).
4. Las correcciones de `0005` en producción: aún no aplicadas.

## 5. Veredicto

**APTO CON CONDICIONES** para conectar la API de Claude y empezar el piloto (condición 1 cumplida el 30/10, ver §6):

1. Aplicar `0005` en producción (sin operaciones destructivas) — necesita tu autorización.
2. Fijar un tope de gasto en la consola de Anthropic y un límite mensual en la oficina antes de la primera ejecución.
3. Recomendado: activar la protección de contraseñas filtradas en Supabase Auth si tu plan lo permite.

## 6. Aplicación de 0005 en producción (30/10/2026)

Aplicada con autorización del administrador (`hardening_idempotency`). Verificado en Supabase real: `anon` sin ningún privilegio sobre tablas, vistas ni funciones; `authenticated` sin TRUNCATE/REFERENCES/TRIGGER y solo puede ejecutar `ai_budget_status`, `decide_approval` e `is_admin`; 4 funciones SECURITY DEFINER; todas las tablas con RLS; `tool_executions` solo escribible por el motor. Avisos del asesor: los dos intencionados y la protección de contraseñas filtradas (pendiente en el panel).
