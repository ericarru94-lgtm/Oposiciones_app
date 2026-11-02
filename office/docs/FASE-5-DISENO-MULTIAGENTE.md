# Fase 5.0 · Auditoría y diseño del sistema multiagente

Fecha: 02/11/2026. Fase **solo de auditoría y diseño**: no se ha modificado código, base de datos, prompts, permisos ni presupuestos. Tampoco se ha ejecutado ninguna misión.

Base auditada: rama `ccr-30b91845-834xuv`, commit `97a7511` (producción en `500245f`; el motor es el mismo en ambos).

Fuentes leídas:

- `src/lib/engine/*`: worker, loop, gateway, coordination, pilot-tools, pilot-prompts, config, cost, store-supabase y anthropic.
- `src/lib/agents/*`: registry, catalog, tools, permissions y prompts.
- `src/app/actions/*`, `src/app/api/engine/*`, las páginas de `tareas`, `empleados` y `centro`.
- Migraciones `0001`–`0008`.

---

## 1. Arquitectura actual verificada

| Pieza | Dónde | Cómo funciona hoy (verificado en el código) |
|---|---|---|
| **Cola de tareas** | tabla `tasks` + `claim_next_task` (0006/0007) | Una tarea `assigned` o `in_progress` con lease caducado se reclama con bloqueo de fila. Respeta dependencias (`task_dependencies`), una ejecución por agente a la vez y un máximo de 2 en paralelo (`ENGINE.maxParallelRuns`). **No comprueba `agents.active`.** |
| **Worker** | `engine/worker.ts` (`runTick`) | Una «pasada» de ~280 s. Reclama tareas y ejecuta pasos hasta terminar, ceder o quedarse sin tiempo. **Rechaza cualquier agente que no esté en `PILOT_AGENT_IDS`** (`alex`, `marcus`, `sofia`): es la barrera real que mantiene inactivos a los otros seis. |
| **Disparo del motor** | `POST /api/engine/tick`, llamado por `engine-runner.tsx` | **No hay cron ni worker en segundo plano.** El motor solo avanza mientras el administrador tiene abierta la página de un encargo (`/tareas/[id]`), que pide pasadas. Si cierras la página, el trabajo se pausa y continúa al volver. |
| **agent_runs** | 0004 | Una fila por intento: estado, pasos, estado serializado (`RunState`), lease, reintentos y error. |
| **Leases y heartbeat** | `assert_lease`, `record_step`, `reserve` | Lease de 240 s (Sofia, 285 s), renovado en cada reserva. Un worker que pierde el lease no puede escribir. |
| **Reintentos y recuperación** | worker + `fail_run` / `defer` | Errores transitorios sin cobro: hasta 3 reintentos con espera exponencial. Errores «inciertos» (no se sabe si Claude cobró): fallan sin repetirse. Las ejecuciones cortadas se reanudan desde el estado guardado sin repetir llamadas. |
| **Delegación** | herramienta `tasks.delegate` → `delegate_task` (SQL) | Solo si el agente es `is_coordinator` (Alex), solo desde una tarea `kind = mission` (**sin subdelegación**) y como máximo `max_rounds` rondas. El esquema permite delegar **solo a `marcus` y `sofia`**. |
| **Dependencias** | `task_dependencies` + `PILOT_DEPENDENCIES` | Sofia espera a Marcus (impuesto por el motor). Si Marcus falla, la dependencia se da por resuelta. |
| **Fases de misión** | `coordination.ts` | `planning` → subtareas → `synthesis`: Alex revisa, puede pedir **una** corrección (ronda 2) y redacta el informe con «Control de coherencia». |
| **ToolGateway** | `engine/gateway.ts` | Puerta única. Aplica `evaluateToolUse` (permiso del agente → herramienta conectada → riesgo), registra en `tool_executions` antes de ejecutar (idempotencia) y exige una aprobación de un solo uso con huella de argumentos para los riesgos altos. |
| **Permisos por riesgo** | `agents/permissions.ts` | `external_action`, `spend`, `production_change` y `destructive` requieren SIEMPRE aprobación. `read` e `internal_write` se ejecutan directamente. |
| **Aprobaciones** | tabla `approvals` + `request_approval` / `consume_approval` | Implementadas en el motor. **Hoy ninguna herramienta conectada las necesita**: todas las conectadas son de lectura o de trabajo interno. |
| **Idempotencia** | `tool_executions` (0005), nonce de misión, `delegate` por `tool_use_id` | Probada. Las misiones usan `idempotency_key = mission:<nonce>`. |
| **Memoria compartida** | `memory_items` + `memory_item_versions` | Solo lectura (`memory.read`). **`memory.write` no está conectada.** |
| **Documentos y entregables** | `documents` + `task_deliveries` (0008) | Se crean con `content.draft` (siempre borrador). Las entregas registran qué recibió cada agente (preparada → enviada → recibida). |
| **CRM con procedencia** | `companies` + `company_facts` (0008) | `crm.write` exige una fuente por dato; la confianza la calcula la base de datos. Topes: 5 empresas y 15 búsquedas por misión. |
| **activity_log** | 0001 | El administrador y el motor registran acciones (misión creada o cancelada, pasos, herramientas). |
| **Control económico** | `ai_reservations`, `reserve_ai_budget`, `ai_usage` (0007) | Reserva atómica ANTES de cada llamada con el peor caso. Liquidación con el coste real. Límites mensual, por misión y por tarea, más una reserva de 0,25 $ para la síntesis de Alex. Un sobrecoste detiene la misión entera. |
| **Integración Anthropic** | `engine/anthropic.ts` | SDK oficial sin reintentos propios, contador de tokens exacto, búsqueda y lectura web básicas (1 + 1 por llamada). Sin respaldo automático de modelo ante un rechazo. |
| **Estados reales** | `agents.status` + Realtime (0008) | El motor escribe el estado (`thinking`, `researching`, `working`…). La oficina 3D y la lista los leen por Realtime, con relectura. |
| **Fichas de empleados** | `/empleados/[id]` | Muestran datos reales (perfil, tareas, historial). **Los botones «Conversar» y «Asignar tarea» están desactivados** («Fase 3»). |
| **Conversaciones** | tablas `conversations` y `messages` (0001) | **Existen pero nada las usa.** |

Límites vigentes (no se tocan en esta fase): 10 $ al mes, 1 $ por misión, 1 $ por tarea, 0,25 $ reservados para la síntesis, 5 empresas y 15 búsquedas por misión. Gasto real acumulado según `CONTEXTO-PROYECTOS.md`: 0,78 $.

## 2. Capacidades reales existentes

**Herramientas con manejador real** (`pilot-tools.ts` + herramientas de servidor):

| Herramienta | Riesgo | Quién la tiene en el piloto |
|---|---|---|
| `memory.read` | Lectura | Alex, Marcus, Sofia |
| `crm.read` | Lectura | Alex, Marcus, Sofia |
| `crm.write` (con procedencia) | Interna | Marcus |
| `content.draft` (borrador) | Interna | Alex, Marcus, Sofia |
| `tasks.delegate` | Interna | Alex (solo a Marcus o Sofia) |
| `web.search` / `web.fetch` (Anthropic, básicas) | Lectura | Marcus |

Además, `tasks.report` funciona de hecho: el resultado final de cada tarea se guarda como documento automáticamente.

**Todo lo demás del catálogo NO tiene manejador**, y la ToolGateway lo rechaza como «no disponible»:

- `memory.write`, `tasks.request_review` y `quality.review`;
- `costs.read`, `analytics.read`;
- `n8n.read`, `n8n.test` y `n8n.production`;
- `email.send`, `outreach.contact`, `social.publish`, `ads.launch` y `media.generate`;
- `data.delete`.

## 3. Funcionalidades que faltan

1. **Asignación directa**: no existe ni la acción de servidor ni la interfaz. El botón está desactivado.
2. **Activación de agentes**: los seis están bloqueados por `PILOT_AGENT_IDS` en el worker y por `PILOT_TOOLS` en la configuración. `claim_next_task` no mira `agents.active`.
3. **Delegación a los nueve**: el esquema `Delegate` y `PILOT_DEPENDENCIES` solo contemplan a Marcus y Sofia, y las guías de Alex solo los describen a ellos.
4. **Herramientas** de los seis: `quality.review`, `costs.read`, `n8n.read` y `n8n.test` no existen.
5. **Ejecución sin la página abierta**: no hay cron. Para encargos largos o varios agentes hace falta un disparador programado (Vercel Cron, con autorización).
6. **Estimación previa de coste** para mostrarla al usuario: el motor estima por llamada, pero no por encargo.
7. **Adjuntos**: no hay almacenamiento de archivos. Supabase Storage existe en el plan, pero no está configurado.
8. **Vista de misión con varias subtareas en paralelo y dependencias**: la página de tarea muestra subtareas, pero está pensada para 2.
9. **Pruebas de aceptación por agente**: hoy solo existen para el flujo Alex → Marcus → Sofia.

## 4. Riesgos detectados

| Riesgo | Gravedad | Detalle y mitigación |
|---|---|---|
| **Modelos caros por defecto** | Alta | Daniel, Lucia, David, Emma y Oscar usan `DEFAULT_MODEL` = **Opus 5.5**. Con 10 $ al mes, unas pocas tareas largas consumirían el presupuesto. **Propuesta, pendiente de tu decisión**: Sonnet 5.5 para David y Victoria, Haiku 5.5 para Daniel, Emma y Oscar, y Sonnet o Haiku para Lucia. |
| Permisos del registro mayores que lo conectado | Media | El registro da a Marcus `email.send` y `outreach.contact`, a Sofia `ads.launch`, a Daniel `social.publish`, a Lucia `media.generate` y a David `n8n.production`. Hoy no tienen manejador (se rechazan), pero **si algún día se conectan, la aprobación humana es la única barrera**. Mantener `PILOT_TOOLS` como lista blanca explícita por agente. |
| `claim_next_task` no filtra agentes inactivos | Media | La barrera está solo en el código del worker. Conviene una segunda barrera en la base de datos (que `claim` ignore agentes con `active = false`), con migración y autorización. |
| Motor dependiente de la página abierta | Media | Varias tareas en cola avanzarían despacio. Requiere cron (Vercel Hobby lo permite una vez al día; más frecuencia, plan Pro) o mantener el disparo manual. |
| Coste de Victoria revisándolo todo | Media | Revisar cada entregable duplica el gasto. Limitarlo a los entregables finales o cuando Alex lo pida. |
| Contexto largo en la síntesis | Media | Con 9 agentes, el inventario y los documentos crecen. Hacen falta resúmenes acotados (ya se recortan a `DOC_CHARS`). |
| Lucia sin generación de imágenes | Informativo | Sin `media.generate` (que es un gasto con aprobación), sus entregables son conceptos y briefs en texto. |
| Óscar sin datos de ingresos | Informativo | Solo hay costes de IA (`ai_usage`). No hay contabilidad real conectada. |

## 5. Diseño de la asignación directa

**Principio: el mismo motor.**

- Un encargo directo es una tarea normal en `tasks`, sin `parent_task_id`, con `agent_id` = el empleado e `input.kind = "direct"`.
- El worker ya ejecuta tareas no-misión (las subtareas lo son). La diferencia es que no tiene padre, así que su límite es el de tarea (1 $) más el mensual.
- **No se crea un segundo motor.**

**Flujo en la ficha del empleado** (`/empleados/[id]`, botón «Asignar tarea»):

1. Formulario: título, encargo (20–8.000 caracteres), restricciones opcionales y un nonce (idempotencia: `direct:<nonce>`).
2. Panel lateral, con datos reales del registro y de la configuración:
   - capacidades y responsabilidades;
   - herramientas activas para él (`PILOT_TOOLS` ∩ permisos);
   - herramientas «no disponibles» con el motivo;
   - qué requeriría aprobación.
3. **Estimación de coste**: rango «mín.–máx.» calculado con el modelo del agente, la salida máxima por llamada y el número de pasos típico. Etiquetada como estimación; el tope real lo aplica la reserva.
4. **Bloqueos visibles**: agente inactivo, presupuesto mensual agotado o motor sin clave de API. El botón se desactiva con el motivo.
5. Al enviar: la acción de servidor `createDirectTask` comprueba la sesión de administrador, que el agente esté activo y el esquema; inserta la tarea, registra `activity_log` (`direct_task.created`) y redirige a `/tareas/[id]`, que ya muestra progreso, coste, documentos, aprobaciones y actividad.
6. **Adjuntos** (fase posterior): Supabase Storage privado, con RLS de administrador, y el texto extraído pasado como contexto con su límite de tamaño.

**No se salta nada**: la ejecución pasa por `claim`, la reserva, la ToolGateway, las aprobaciones y los límites existentes.

## 6. Diseño de la delegación de Alex (9 agentes)

1. **Catálogo de capacidades para Alex**: una sección generada del registro y de `PILOT_TOOLS` en el mensaje inicial (no en el prompt fijo, para no romper la caché). Para cada agente activo: especialidad, herramientas reales y entregables. **Los inactivos no aparecen.**
2. **`tasks.delegate` ampliado**: `agent` acepta cualquier agente **activo** salvo Alex.
   - Validación doble: esquema zod generado de la lista de activos, y en SQL `delegate_task` comprueba `agents.active` y que el destino no sea coordinador.
   - Se mantiene «solo desde misión, sin subdelegación».
3. **Dependencias**: Alex las declara con `depends_on` (ya existe). `PILOT_DEPENDENCIES` pasa a ser un mínimo de seguridad, no la única fuente.
4. **Tope por misión**: máximo N subtareas por ronda (propuesta: 4), 2 rondas (ya existe `max_rounds`) y una sola corrección por agente.
5. **Revisión**: Victoria (con `quality.review`) solo cuando Alex lo pida o en entregables marcados como finales. Su veredicto (aprobado / devuelto con observaciones) se guarda vinculado al documento.
6. **Síntesis**: igual que ahora (inventario, resultado declarado de cada subtarea y control de coherencia), pero con resúmenes acotados por agente.
7. **Control de coste**:
   - el presupuesto de misión (1 $) se reparte por reserva;
   - con menos de 0,25 $ restantes Alex no puede delegar más y pasa a la síntesis (se reutiliza `synthesis_reserve_usd`).

## 7. Fichas técnicas de los seis agentes

Leyenda: **[Existe]** = manejador ya hecho; **[Nueva]** = hay que construirla; **[Fuera]** = no se activa en la fase 5.

### Daniel · Contenidos
- **Objetivo**: textos útiles para captar clientes: copys, guiones, artículos y documentación, siempre en borrador.
- **Puede**: redactar posts, guiones de reels, artículos de blog, emails y DMs **como borrador**, y documentación interna; reescribir y adaptar el tono.
- **No puede**: publicar, programar ni enviar nada; inventar datos, testimonios o cifras.
- **Herramientas**: `memory.read`, `crm.read` y `content.draft` **[Existe]**. `web.search` en lectura **[Existe, opcional]**, con tope de búsquedas. `social.publish` **[Fuera]**.
- **Datos**: lee memoria y CRM; solo crea documentos.
- **Entregables**: documento `script`, `proposal` u `other` con el texto final y sus variantes.
- **Dependencias**: suele ir después de Sofia (estrategia) o Marcus (datos de la empresa).
- **Riesgos**: afirmaciones sin fuente → regla de honestidad + revisión de Victoria cuando Alex la pida.
- **Aceptación**: crea al menos un documento; no contiene «publicado» ni «enviado»; cita la fuente de cada dato de empresa.

### Lucia · Creatividad y diseño
- **Objetivo**: conceptos visuales y materiales comerciales en forma de brief.
- **Puede**: conceptos de campaña, briefs para diseño, guías de estilo aplicadas a la marca HE Signal, estructura de carruseles y prompts de imagen para revisión humana.
- **No puede**: generar ni comprar imágenes o vídeo (`media.generate` es un gasto) **[Fuera]**, ni usar marcas o personas reales sin permiso.
- **Herramientas**: `memory.read` y `content.draft` **[Existe]**; `web.fetch` para referencias **[Existe, opcional]**.
- **Entregables**: documento `creative` con concepto, paleta (de la marca), textos de pieza y especificaciones.
- **Dependencias**: suele ir después de Sofia y Daniel.
- **Aceptación**: respeta los colores y tipografías de la marca (los lee de la memoria); no afirma haber creado imágenes.

### David · Automatización e IA
- **Objetivo**: diseñar y diagnosticar automatizaciones (n8n, chatbots, integraciones).
- **Puede**:
  - diseñar flujos (especificación paso a paso, nodos, datos y errores);
  - documentar integraciones y API;
  - diagnosticar a partir de lo que se le pase;
  - **en una fase posterior**, leer workflows de n8n.
- **No puede**: modificar ni activar nada en producción (`n8n.production` **[Fuera]**), ni probar webhooks reales sin entorno de pruebas aprobado.
- **Herramientas**: `memory.read`, `content.draft` y `web.fetch` (documentación pública) **[Existe]**. `n8n.read` **[Nueva, requiere conectar n8n con clave de solo lectura]** y `n8n.test` **[Nueva, solo webhook de pruebas]**: ambas en una fase posterior y con autorización.
- **Entregables**: documento `technical` con diagrama en texto, pasos, riesgos y pruebas.
- **Aceptación**: especificación ejecutable a mano; sin afirmar que algo «ya funciona».

### Emma · Atención al cliente
- **Objetivo**: preparar respuestas y seguimiento de clientes.
- **Puede**: clasificar consultas que el administrador le pegue, redactar respuestas en borrador, preparar planes de seguimiento y anotar en el CRM el estado del seguimiento.
- **No puede**: enviar emails ni mensajes (`email.send` **[Fuera]**); guardar datos personales sin base legal (RGPD).
- **Herramientas**: `memory.read`, `crm.read` y `content.draft` **[Existe]**. `crm.write` **[Existe]**, solo para el estado de seguimiento, con las mismas reglas de procedencia y sin emails personales (ya lo bloquea el manejador).
- **Entregables**: documento con la respuesta propuesta y la clasificación (tipo, urgencia, siguiente paso).
- **Aceptación**: nunca dice «enviado»; respeta la LSSI (uno a uno, sin envíos masivos).

### Óscar · Finanzas y datos
- **Objetivo**: control de costes reales de la oficina y análisis de rentabilidad de servicios.
- **Puede**: informes de gasto real de IA (por mes, agente, misión y tarea), proyecciones etiquetadas como estimación, y presupuestos de servicios con supuestos explícitos.
- **No puede**: inventar ingresos ni cifras de clientes; tocar los límites de gasto.
- **Herramientas**: `memory.read`, `crm.read` y `content.draft` **[Existe]**. `costs.read` **[Nueva]**: lectura de `ai_usage`, `ai_reservations` y límites, mediante una función de solo lectura del servidor. `analytics.read` **[Fuera]** hasta conectar Metricool.
- **Entregables**: documento `report` con tablas de coste real y la consulta usada.
- **Aceptación**: las cifras coinciden con `ai_usage` (comprobable con SQL); las estimaciones van marcadas.

### Victoria · Control de calidad
- **Objetivo**: revisar entregables antes de que lleguen al usuario.
- **Puede**: comprobar coherencia, fuentes, cumplimiento del encargo, errores, tono y LSSI/RGPD; aprobar o devolver con observaciones concretas.
- **No puede**: reescribir el entregable entero (devuelve observaciones), ni aprobar acciones externas (eso es del administrador).
- **Herramientas**: `memory.read`, `crm.read` y `content.draft` **[Existe]**. `quality.review` **[Nueva]**: registra el veredicto vinculado al documento revisado (`approved` o `changes_requested`) con una lista de observaciones. `web.fetch` para verificar fuentes **[Existe, opcional]**.
- **Entregables**: veredicto estructurado y documento de revisión.
- **Aceptación**: cada observación señala la sección o el dato; detecta un error sembrado en un entregable de prueba.

## 8. Herramientas necesarias y viabilidad

| Herramienta | Riesgo | Viabilidad | Trabajo |
|---|---|---|---|
| `quality.review` | Interna | Alta | Manejador + tabla o columna de revisión (migración) |
| `costs.read` | Lectura | Alta | Manejador + función SQL de solo lectura sobre `ai_usage` y reservas |
| Asignación directa | — | Alta | Acción de servidor + interfaz; sin migración (usa `tasks`) |
| Delegación a 9 | Interna | Alta | Esquema dinámico + comprobación de activos en `delegate_task` (migración) |
| `n8n.read` | Lectura | Media | Necesita la URL de n8n y una clave de **solo lectura** (variable de entorno, autorización) |
| `n8n.test` | Interna | Media | Solo webhooks de pruebas; lista blanca de URL |
| Adjuntos | Interna | Media | Supabase Storage privado y RLS (migración) |
| Cron del motor | — | Media | Vercel Cron: frecuencia limitada en Hobby |
| `memory.write` | Interna | Alta | Ya hay versiones (`memory_item_versions`); manejador con origen obligatorio |
| `email.send`, `outreach.contact`, `social.publish`, `ads.launch`, `media.generate`, `n8n.production`, `data.delete` | Externa, gasto, producción o destructiva | — | **Fuera de la fase 5.** Si se activan, siempre con aprobación de un solo uso |

## 9. Plan de fases

Cada fase termina con pruebas en verde, informe y **tu autorización** antes de la siguiente. Nada en producción sin autorización expresa.

| Fase | Contenido | Migración | Activa agentes |
|---|---|---|---|
| **5.1** | **Base común sin activar a nadie.** Lista blanca de agentes activos en un solo sitio (`ACTIVE_AGENT_IDS`, hoy igual a los 3 del piloto). Segunda barrera en `claim_next_task` (ignora `active = false`). `PILOT_TOOLS` para los nueve (vacío para los inactivos). Ajuste de modelos por agente **si lo apruebas**. Pruebas de que nada cambia para los 3 actuales. | Sí (claim) | No |
| **5.2** | **Asignación directa** a Alex, Marcus y Sofia (los ya activos): acción de servidor, formulario en la ficha, panel de capacidades y estimación de coste. | No | No |
| **5.3** | **Daniel y Lucia** (solo herramientas existentes, riesgo bajo). Guías, `PILOT_TOOLS` y asignación directa. Pruebas con modelo simulado y **una** tarea real de prueba por agente, con tu autorización y un tope de coste. | No | Sí: 2 |
| **5.4** | **Óscar** + `costs.read`. **Emma** (borradores + estado de seguimiento en el CRM). | Sí (función de costes) | Sí: 2 |
| **5.5** | **Victoria** + `quality.review`. | Sí (revisiones) | Sí: 1 |
| **5.6** | **David** sin n8n (especificaciones). Opcional: `n8n.read` con clave de solo lectura (variable de entorno, autorización aparte). | Opcional | Sí: 1 |
| **5.7** | **Delegación de Alex a los nueve**: catálogo de capacidades, esquema dinámico, comprobación de activos en `delegate_task`, topes por ronda, revisión de Victoria y síntesis con resúmenes. Una misión real de prueba con tu autorización. Cron del motor si lo apruebas. | Sí (delegate) | No (ya activos) |

## 10. Presupuesto estimado y controles

Las estimaciones se basan en las misiones reales del piloto (0,17–0,32 $ cada una, Alex + Marcus + Sofia).

| Tarea típica | Haiku 5.5 | Sonnet 5.5 | Opus 5.5 |
|---|---|---|---|
| Encargo directo de texto (2–4 llamadas) | 0,01–0,04 $ | 0,03–0,12 $ | 0,10–0,40 $ |
| Misión de Alex con 3–4 agentes | — | 0,30–0,80 $ | — |

- **Pruebas de las fases 5.3–5.7**: en total, del orden de **1–3 $** con modelos Haiku o Sonnet. Con Opus podría superar los 5 $.
- **Controles que se mantienen sin cambios**:
  - 10 $ al mes, 1 $ por misión y 1 $ por tarea;
  - reserva atómica antes de cada llamada;
  - parada por sobrecoste;
  - búsquedas limitadas;
  - sin respaldo automático de modelo.
- **Nuevos controles**:
  - estimación visible antes de ejecutar;
  - tope de subtareas por ronda;
  - corte de delegación con menos de 0,25 $ restantes;
  - pruebas reales solo con autorización y por agente.

## 11. Pruebas de aceptación

- **Unitarias**:
  - esquema de asignación directa;
  - esquema `Delegate` dinámico (rechaza inactivos y a Alex);
  - `evaluateToolUse` para cada agente (herramientas permitidas, no disponibles y que requieren aprobación);
  - estimación de coste;
  - `quality.review` y `costs.read` con datos de prueba.
- **Integración** (PostgreSQL embebido, como las actuales):
  - `claim` ignora agentes inactivos;
  - `delegate_task` rechaza inactivos, subdelegación y una tercera ronda;
  - el encargo directo respeta los límites de tarea y mes;
  - idempotencia del nonce;
  - la revisión queda vinculada al documento.
- **Seguridad**:
  - ninguna herramienta externa se ejecuta sin aprobación;
  - RLS de las tablas nuevas;
  - los prompts y secretos no llegan al cliente (prueba existente ampliada);
  - un agente inactivo no se ejecuta aunque se inserte una tarea a mano.
- **Extremo a extremo**:
  - asignar desde la ficha → la tarea aparece → progreso → documento → coste mostrado igual a `ai_usage`;
  - misión de Alex con dependencias → las subtareas se ejecutan en orden → síntesis con inventario.
- **Verificación de trabajo real**: una tarea solo cuenta como hecha si:
  1. hay al menos un documento o registro creado en esa tarea (`documents.task_id`, `company_facts`, revisión);
  2. hay coste real registrado en `ai_usage`;
  3. el bloque `resultado` declara los objetivos;
  4. en las misiones, Alex los contrasta en el «Control de coherencia».

  La interfaz muestra esas evidencias, no una afirmación del agente.

## 12. Archivos por fase

| Fase | Archivos |
|---|---|
| 5.1 | `src/lib/agents/catalog.ts`, `src/lib/engine/config.ts`, `src/lib/engine/worker.ts`, `src/lib/agents/registry.ts` (solo modelos, si se aprueba), migración `0009_active_agents.sql`, pruebas |
| 5.2 | `src/app/actions/direct-task.ts` (nuevo), `src/app/(office)/empleados/[id]/page.tsx` + formulario nuevo, `src/lib/engine/estimate.ts` (nuevo), `src/components/office/office-view.tsx` (botón en la ficha lateral), pruebas |
| 5.3 | `src/lib/engine/pilot-prompts.ts` (guías de Daniel y Lucia), `config.ts`, pruebas |
| 5.4 | `src/lib/engine/pilot-tools.ts` (`costs.read`), migración `0010_costs_read.sql`, `pilot-prompts.ts`, `config.ts`, pruebas |
| 5.5 | `pilot-tools.ts` (`quality.review`), migración `0011_reviews.sql`, `src/app/(office)/tareas/[id]/page.tsx` (veredictos), pruebas |
| 5.6 | `pilot-prompts.ts`, `config.ts`; opcional: `pilot-tools.ts` (`n8n.read`), `src/lib/env.ts` |
| 5.7 | `pilot-tools.ts` (esquema `Delegate`), `coordination.ts`, `pilot-prompts.ts` (catálogo para Alex), migración `0012_delegate_active.sql`, `tareas/[id]/page.tsx` (vista de subtareas), `vercel.json` (cron, si se aprueba), pruebas |

---

**Decisiones que necesito antes de la fase 5.1**:

1. ¿Cambiamos los modelos de los seis (hoy, cinco en Opus 5.5) a Sonnet o Haiku, como se propone?
2. ¿Segunda barrera en la base de datos (`claim` ignora inactivos), con su migración?
3. ¿Orden de activación: Daniel y Lucia → Óscar y Emma → Victoria → David?
