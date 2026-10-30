# Prevuelo del piloto real · ejecución sin segundo plano y presupuesto

30/10/2026. Revisión pedida antes de la primera misión real. Primer veredicto: **NO APTO**. Correcciones A–D implementadas en local con autorización; la migración `0007_budget_reservations.sql` está **pendiente de autorización** para aplicarse en Supabase.

## Fallos encontrados (antes de corregir)
1. El lease (240 s) no se renovaba durante una pasada (hasta 280 s): otra pestaña podía ejecutar la misma tarea a la vez y el coste de la llamada ya pagada se perdía. Demostrado con una prueba.
2. Sin reserva previa: el presupuesto se comprobaba después de cada llamada; dos tareas en paralelo podían superarlo y una respuesta perdida no se contabilizaba.
3. El límite de 1 $ era por tarea, no por misión (hasta ~3 $ por misión).
4. Sin tope real de empresas ni de búsquedas por misión.
5. Un corte entre la llamada y el guardado repetía la llamada; un error reintentable reiniciaba la conversación desde cero.
6. La interfaz siempre decía «trabajando»; no se podía detener una misión.

## Correcciones
**Motor (A)**
- Por cada llamada: `reserve_budget` (reserva + renovación del lease) → llamada (timeout 150 s < lease 240 s) → `record_call` (coste real y respuesta guardados ANTES de ejecutar herramientas) → herramientas idempotentes por `tool_use_id`.
- Al recuperar tras un corte se ejecutan las herramientas de la respuesta guardada; la llamada no se repite.
- Errores de la API: sin cobro (429, 529, 503, 408, 409, 4xx) → se libera la reserva; los transitorios se reintentan en la MISMA ejecución y conversación (`defer_run`, 30/60/120 s, máx. 3). Cobro desconocido (sin respuesta, tiempo agotado, 500) → reserva «incierta» (cuenta como gastada), la tarea se detiene y no se repite.
- Un error en una tarea no tumba la pasada; el lease caduca y otra pasada la retoma desde el último estado guardado.

**Base de datos (B, migración 0007, no destructiva)**
- `ai_reservations`; gasto comprometido = `ai_usage` + reservas abiertas + inciertas.
- `reserve_budget` bloquea la fila de límites (`FOR UPDATE`): las reservas se serializan. Límites mensual, por misión (encargo + subtareas + reintentos) y por tarea. Las subtareas no pueden usar los 0,25 $ reservados para el informe de Alex.
- `record_call` registra el coste aunque el lease se haya perdido o la misión se haya detenido. `ai_usage` separa `claude_cost_usd` y `search_cost_usd`.
- Topes de misión en la base de datos: 5 empresas (disparador en `companies`) y 15 búsquedas (la reserva concede solo las que quedan).
- `claim_next_task` con bloqueo de transacción: el máximo de tareas simultáneas es exacto.
- `cancel_mission` (solo servidor, a petición del administrador).

**Interfaz (C)**: estado real de la misión calculado desde la base de datos (trabajando / reintento a las HH:MM / en pausa con trabajo listo / esperando al equipo / terminada / detenida), «Reanudar ahora», «Detener misión», coste de la misión con desglose Claude/búsquedas, reservado e incierto, contadores de búsquedas y empresas.

**Configuración (D)**: 1 $ por misión, 10 $ al mes, 1 $ por tarea, 5 empresas, 15 búsquedas, 0,25 $ reservados para el informe; salida máx. 8.000 tokens; Marcus 3 búsquedas + 2 lecturas (10.000 tokens) por llamada. Herramientas externas siguen bloqueadas; todo en borrador.

## Reserva conservadora por llamada
`(contexto + contenido web máximo) × precio de entrada × 1,25 + nº de iteraciones de herramientas × contexto × precio de lectura de caché + salida máxima × precio de salida + búsquedas × 0,01 $`, con contexto estimado a 3 caracteres por token. Supuesto: las iteraciones internas de búsqueda reutilizan la caché; si no lo hicieran, una sola llamada podría costar algo más que su reserva, pero el coste real se registra y la siguiente reserva ya lo cuenta. Última red: tope de 15 $ en la consola de Anthropic.

## Escenarios
| Caso | Resultado |
|---|---|
| Cerrar pestaña / sin Internet / navegador suspendido | La pasada en curso termina y guarda; después, pausa. Al volver se reanuda. |
| Dos pestañas / dos pasadas a la vez | No se duplican tareas, llamadas ni documentos (prueba). |
| Vercel corta la función | El lease caduca; se retoma desde el último estado guardado; una llamada a medias queda incierta y no se repite. |
| Respuesta perdida | Incierta = gastada; tarea detenida; no se repite (prueba). |
| Subtarea > 30 min desde que empezó | Caduca (`timed_out`); Alex informa con lo disponible. |
| Reabrir misión interrumpida | Se reanuda sola; botón «Reanudar ahora». |

## Pruebas
120 pruebas. Nuevas: `tests/budget-recovery.test.ts` (11) y 2 de concurrencia real en PostgreSQL 18 (`tests/concurrency.test.ts`): ocho pasadas simultáneas respetan el máximo de 2 tareas; seis reservas simultáneas de 0,15 $ con 0,50 $ de saldo → exactamente 3. Verificado que ambas fallan si se quitan los bloqueos.

## Limitaciones que siguen
- Sin segundo plano: el trabajo avanza solo con la página abierta.
- Una llamada incierta detiene esa tarea; hay que crear otra misión.
- La reserva de una llamada de Marcus ronda 0,20–0,30 $: con 0,75 $ disponibles para subtareas, Marcus y Sofia tienen margen para pocas llamadas a la vez (se liberan al liquidar).
