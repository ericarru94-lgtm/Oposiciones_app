# Fase 5.2.1 · Plan de misión aprobado por el administrador

Fecha: 04/11/2026 (con las comprobaciones A–D del administrador). Estado: **implementado y probado solo en local** (PGlite y PostgreSQL embebido 17.11 y 18, Claude simulado). **No aplicado en producción. Sin commit.**

## Qué cambia

En una misión nueva, Alex ya no delega directamente:
1. **Propone un plan** con la herramienta `mission.plan`.
2. **Nada se ejecuta** hasta que el administrador decide.
3. El administrador elige:
   - **Aprobar**: se crean las subtareas de los pasos, con sus límites.
   - **Pedir cambios**: vuelve a Alex con el motivo.
   - **Rechazar**: la misión se cancela.
4. En la síntesis, Alex puede proponer una **ampliación**: solo pasos nuevos y con otra aprobación expresa.

Las misiones anteriores (`plan_required = false`) siguen exactamente igual: delegan con `tasks.delegate`.

## Decisiones del administrador aplicadas

| Regla | Dónde se cumple |
|---|---|
| «Pedir cambios» y «Rechazar» son opciones separadas | `reject_mission_plan(…, 'changes' \| 'reject')` |
| Pedir cambios devuelve el plan a Alex con el motivo | `input.plan_feedback`; Alex recibe el motivo y su versión anterior |
| Rechazar cancela la misión definitivamente | `cancel_mission` |
| Máximo 3 versiones por misión (iniciales, reformulaciones y ampliaciones) | `CHECK version between 1 and 3`; `submit_mission_plan`; «pedir cambios» no se ofrece en la v3 |
| Al llegar al límite no se reformula más: decide el administrador | En la v3 solo se puede aprobar o rechazar |
| Toda ampliación necesita versión nueva y aprobación expresa, sin aprobación automática ni umbrales | No existe ningún camino que apruebe sin `approve_mission_plan` |
| Máximo 2 rondas | `pilot.max_rounds` (techo 2): ronda 1 = plan inicial; como mucho 1 ampliación en la ronda 2 |
| Los pasos aprobados son inmutables; las ampliaciones solo añaden pasos | Alex envía solo los pasos nuevos; la base de datos copia los aprobados tal cual y comprueba al aprobar que la base no ha cambiado |
| Los pasos nuevos pasan todas las validaciones | La misma función `validate_mission_plan` al proponer y al aprobar |
| Ningún paso se ejecuta antes de su aprobación | Las subtareas solo se crean en `approve_mission_plan` |

**«2 rondas» (confirmado por el administrador el 04/11):** ronda 1 = plan inicial; ronda 2 = única ampliación permitida. No hay más ampliaciones.

## Base de datos (`0013_mission_plans.sql`)

**Columnas nuevas en `tasks`**
- `plan_required`. Las filas existentes quedan en `false`; en las nuevas, el valor por defecto es `true`.
- `plan_id`, `plan_step_key`, `budget_usd`, `max_calls` y `max_searches`.

**Trigger `tasks_plan_guard`**
- Desde el navegador una misión **siempre** necesita plan y empieza en planificación (ronda 1). Además, no se pueden poner límites ni un `plan_id`.
- Nadie puede cambiar después `plan_required` ni los límites de un paso (ningún rol).

**Tablas `mission_plans` y `mission_plan_steps`**
- Contenido de un plan: versión, tipo (`initial` o `amendment`), plan en JSON, **huella sha256** calculada por la base de datos, presupuesto, estado, caducidad (72 h) y decisión.
- Por misión puede haber como mucho un plan pendiente y uno aprobado.
- **Inmutables**: no se pueden borrar ni vaciar.
- Del plan solo cambia el estado, con transiciones fijas.
  - Aprobar, rechazar, pedir cambios y caducar solo los hacen las funciones del administrador.
  - El servidor solo puede sustituir una propuesta pendiente por otra.
- De los pasos solo se anota una vez la subtarea creada.

**Funciones del servidor** (con lease; EXECUTE solo para service_role)
- `submit_mission_plan(run, worker, resumen, pasos_nuevos)`:
  - normaliza el plan, lo valida y lo guarda como pendiente;
  - es idempotente por ejecución;
  - una propuesta distinta en la misma ejecución se rechaza.
- `await_plan_approval(run, worker, resumen)`:
  - la misión pasa a `needs_approval`, fase `plan_review`;
  - `started_at` queda vacío, para que el tiempo máximo no corra mientras espera.
- `validate_mission_plan(...)` comprueba cada paso nuevo:
  - entre 1 y `max_subtasks` pasos en total;
  - claves únicas;
  - agente especialista (no coordinador) que esté en los techos, en `pilot.agents` y activo;
  - herramientas de la **lista cerrada por agente** `plan_step_tools()` (Marcus: `memory.read`, `crm.read`, `crm.write`, `content.draft`, `web.search` y `web.fetch`; Sofia: `memory.read`, `crm.read` y `content.draft`) que además tenga el agente en `agents.tools`. Sofia no puede recibir `web.search` aunque el registro general la incluya;
  - dependencias existentes y sin ciclos (algoritmo de Kahn);
  - presupuesto mayor que 0 y no mayor que el límite por tarea, con 4 decimales como máximo;
  - de 1 a 30 llamadas; búsquedas ≥ 1 solo si usa `web.search` (si no, 0).

  Y en conjunto:
  - **lo comprometido en la misión + los pasos nuevos + la reserva del informe ≤ límite de la misión** (y lo mismo con el mes);
  - las búsquedas, dentro del máximo de la misión.

**Decisiones del administrador** (SECURITY DEFINER, `is_admin`, EXECUTE solo para authenticated)
- `approve_mission_plan(plan, versión, huella, nota)`:
  1. bloquea la fila `limits` (se serializa con las reservas), el plan y la misión;
  2. exige versión y huella exactas, comprueba que los pasos guardados coinciden con el JSON y la caducidad;
  3. **vuelve a validarlo todo** con el saldo de ese momento;
  4. crea las subtareas: idempotencia `plan:<misión>:<paso>`, límites y dependencias;
  5. la misión espera en fase de síntesis, ronda + 1;
  6. registra `plan.approved` en `activity_log`.
- `reject_mission_plan(plan, versión, huella, motivo, 'changes' | 'reject')`:
  - el motivo es obligatorio;
  - con `changes`, vuelve a planificación (o a la síntesis si era una ampliación) con el motivo, como máximo hasta la v3;
  - con `reject`, `cancel_mission`;
  - registra `plan.changes_requested` o `plan.rejected`.
- **Caducidad (72 h):** se comprueba al decidir. El plan queda «caducado», la misión se detiene y se registra `plan.expired`.

**Cambios en funciones existentes**
- `delegate_task` se niega en las misiones con plan. El resto es idéntico a 0006.
- `reserve_budget` es igual que en 0007 y añade:
  - **presupuesto del paso**: motivo `step_budget`, comprobado antes que el límite por tarea;
  - **llamadas máximas**: motivo `max_calls`; cuentan todas las reservas salvo las liberadas, también las inciertas;
  - **búsquedas del paso**: solo se conceden las que quedan.

**Permisos**
- El navegador **solo lee** planes y pasos, con RLS de administrador.
- service_role tiene SELECT, INSERT y UPDATE (vigilados por los triggers); no puede borrar.

**Marcha atrás:** `supabase/checks/0013_rollback.sql`.
- Devuelve `delegate_task` y `reserve_budget` exactamente a 0006 y 0007.
- Quita las funciones, el trigger y las columnas.
- **Conserva los planes como archivo de solo lectura**: no borra filas.
- Se puede volver a aplicar 0013 después (reutiliza el archivo).

## Comprobaciones A–D del administrador (04/11)

**A · Herramientas por agente en la base de datos.**
- `plan_step_tools()` es una lista cerrada por agente; ampliarla exige una migración.
- Una prueba comprueba que coincide con `AGENT_TOOLS.enabled` (sin delegar ni proponer planes).
- También se exige `agents.tools`.

**B · Única vía para crear subtareas: `approve_mission_plan`.** Rutas auditadas:

| Ruta | Resultado |
|---|---|
| Navegador: INSERT directo en `tasks` | rechazado si el padre es una misión con plan |
| Servidor (service_role): INSERT directo | rechazado, también con un `plan_id` |
| SQL directo (postgres) | rechazado sin `plan_id`; solo `approve_mission_plan` lo pone, y se ejecuta como su dueño |
| `delegate_task` | rechazada en las misiones con plan |
| Mover una tarea a una misión con plan (o sacarla de ella) | rechazado para todos |
| Cambiar el agente, el título o las instrucciones de un paso aprobado | rechazado para todos, también para el administrador |
| El motor | solo ejecuta una subtarea de una misión con plan si es la subtarea registrada de un paso aprobado (si no, `not_in_plan`) |

Las misiones antiguas siguen creando subtareas como siempre.

**C · Saldo mensual.**
- **Había riesgo:** un plan aprobado no reservaba dinero del mes, así que dos misiones aprobadas a la vez podían comprometer más que el límite mensual.
- **Corregido sin cambiar ningún límite:**
  - al aprobar se fija `envelope_usd` = lo comprometido en la misión + los pasos nuevos + la reserva del informe;
  - `plan_outstanding_usd()` suma lo aprobado y aún no gastado de las misiones abiertas;
  - la validación del plan y `reserve_budget` cuentan lo comprometido por **otras** misiones; cada misión gasta de lo suyo;
  - las dos bloquean la fila `limits`, así que la comprobación es atómica;
  - lo comprometido se libera al terminar o cancelarse la misión;
  - `envelope_usd` solo lo fija la aprobación y no se puede cambiar.

**D · Publicación.**
- El código nuevo funciona sin 0013.
- Mientras falte la tabla `mission_plans`, `createMission` no crea encargos y el formulario aparece bloqueado con un aviso.
- Falla cerrado: cualquier error al comprobarlo también bloquea.

## Motor (TypeScript)

- **Herramienta `mission.plan`** (catálogo, Alex en el registro y en `AGENT_TOOLS`). Antes de proponer comprueba:
  - herramientas habilitadas del agente (`scopeTools`);
  - búsquedas coherentes;
  - **presupuesto mínimo por paso**: la reserva de una llamada de ese agente con esas herramientas.

  Además añade el orden «Sofia espera a Marcus», visible en el plan que aprueba el administrador.
- **Herramientas por fase** (`engine/plan.ts`), iguales en todas las llamadas de una ejecución:

  | Caso | Herramientas |
  |---|---|
  | Misión antigua | las de siempre, sin `mission.plan` |
  | Planificación | `memory.read`, `crm.read` y `mission.plan` (máximo 4 llamadas) |
  | Síntesis | `memory.read`, `crm.read` y `content.draft`, más `mission.plan` solo si aún se puede ampliar |
  | Paso del plan | las del paso ∩ las habilitadas, nunca `tasks.delegate` |

  Ninguna misión con plan tiene `tasks.delegate`. Las propuestas de la propia ejecución no cuentan, para que la lista no cambie al reanudarse.
- **Fin de turno:**
  - con un plan pendiente de esta ejecución, la misión espera la aprobación;
  - si la planificación termina **sin plan**, la misión se detiene y no se ejecuta nada.
- **Prompts:**
  - guía de Alex para misiones con plan;
  - «PRESUPUESTO PARA EL PLAN» con cifras de la base de datos;
  - motivo del administrador y versión anterior al pedir cambios;
  - plan aprobado en la síntesis;
  - límites del paso en cada subtarea.
- **Paradas** con mensaje y cifras: `step_budget`, `max_calls` y búsquedas del paso.
- **Control de coherencia:** el informe incluye el estado de cada paso del plan aprobado. Un paso fallido genera un aviso.
- **Compatibilidad:** `getTask`, la página de la misión y el Centro de mando funcionan **con y sin** 0013.

## Interfaz

- **Página de la misión:**
  - panel del plan con resumen, pasos, límites, totales, caducidad y huella;
  - botones **Aprobar**, **Pedir cambios** (con motivo) y **Rechazar** (con motivo y confirmación);
  - historial de versiones;
  - mientras el plan espera, la página no pide pasadas del motor.
- **Centro de mando:** planes pendientes y su enlace.
- La acción `decidePlan` usa la sesión del administrador. No usa la clave del servidor: las funciones comprueban `is_admin`.

## Orden de publicación (cuando se autorice)

Orden confirmado por el administrador: **código → copia de seguridad → migración 0013 → comprobaciones de producción**.

1. **Primero el código, después la migración.** Entre los dos pasos la creación de encargos queda bloqueada (comprobación D). El código nuevo funciona sobre la base de datos sin 0013 (probado en `compat-sin-0013.test.ts`). El código actual de producción (`a60bca5`) **no** está preparado para 0013:
   - el navegador crearía misiones con plan;
   - el motor antiguo intentaría delegar;
   - `delegate_task` se negaría.
2. Copia lógica previa y aplicación de 0013 en una transacción, como en 0010–0012.
3. Primera misión con plan: requiere autorización (es una llamada real).

## Pruebas

- `tests/mission-plan.test.ts` (18):
  - valores por defecto y bloqueo desde el navegador;
  - `delegate_task`;
  - propuesta idempotente;
  - 20 casos de validación;
  - aprobar (permisos, huella, versión, subtareas, dependencias, auditoría);
  - revalidación con saldo y agentes;
  - pedir cambios y límite de 3;
  - rechazar; caducidad; inmutabilidad;
  - ampliaciones; límites del paso en `reserve_budget`.
- `tests/plan-flow.test.ts` (13): extremo a extremo con Claude simulado:
  - plan, aprobación, pasos e informe;
  - fin sin plan;
  - plan rechazado por el motor;
  - herramientas del paso;
  - presupuesto y llamadas del paso;
  - ampliación, otra aprobación y fin de rondas;
  - lista de herramientas estable al reanudar;
  - pedir cambios;
  - reglas del motor sin base de datos.
- `tests/migration-0013.test.ts` (PostgreSQL 17.11 y 18):
  - aditiva y transaccional; ningún dato cambia;
  - aplicarla dos veces falla;
  - inventario de SECURITY DEFINER y permisos;
  - **dos aprobaciones simultáneas** y **aprobar y pedir cambios a la vez**: gana una;
  - marcha atrás exacta, que conserva el archivo;
  - el camino antiguo vuelve a funcionar; volver a aplicar.
- `tests/plan-ui.test.ts`: totales, botones visibles y estado «plan pendiente».
- `tests/compat-sin-0013.test.ts`: código nuevo sobre una base de datos sin 0013.
- **Pruebas adaptadas:**
  - las que crean misiones directamente indican `plan_required = false` (camino antiguo);
  - inventario de SECURITY DEFINER y EXECUTE;
  - herramientas de Alex;
  - esquema JSON de herramientas (solo se añade `mission.plan`);
  - `seed.sql`.
- `tests/plan-publication.test.ts`: la ventana de publicación (sin 0013 no se crea ningún encargo, también si la comprobación da error).
- `mission-plan` añade las comprobaciones A, B y C; `migration-0013` añade la concurrencia económica en 17.11 y 18; `plan-flow` añade la barrera del motor.
- **Contrapruebas:** se quitaron una a una 31 protecciones (24 de SQL y 7 de TypeScript) y en todos los casos falla al menos una prueba.

## Riesgos que quedan

- **service_role** (el servidor de la oficina) sigue pudiendo insertar tareas directamente, como antes. El motor no lo hace, y cualquier plan que inserte por su cuenta se vuelve a validar al aprobarlo.
- **service_role** puede **sustituir** una propuesta pendiente. No puede aprobarla, rechazarla ni cambiarla.
- Las listas de herramientas viven en dos sitios (`plan_step_tools()` y `AGENT_TOOLS`). Una prueba falla si dejan de coincidir.
- Lo comprometido por un plan cuenta aunque la misión cruce de mes: es una regla conservadora.
- Si Alex gasta en la síntesis más que la reserva de 0,25 $ (con el tope de la misión), ese exceso sale del saldo libre del mes, nunca de lo comprometido por otras misiones.
- Un administrador con acceso total a la base de datos (desactivando triggers) podría colar tareas: el motor las rechaza (`not_in_plan`).
- La **caducidad** se aplica al decidir. Un plan caducado sin decisión deja la misión parada sin gastar nada; la página lo muestra como «Caducado».
- **Rechazar una ampliación cancela la misión entera**, como se decidió, y se pierde el informe final. La interfaz pide confirmación.
- El `seed.sql` local añade `mission.plan` a las herramientas de Alex. En producción **no se ha tocado**: el motor usa el registro del código.
