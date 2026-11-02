# Fase 5.1 · Infraestructura y seguridad multiagente

Fecha: 02/11/2026. Todo el trabajo es local.

- Sin commit, sin push y sin despliegue.
- **Migración 0009 escrita y probada, sin aplicar** en Supabase.
- Producción sigue en `500245f`.
- Base: `97a7511`.

## 1. Auditoría previa

- Rama `ccr-30b91845-834xuv` en `97a7511`, igual en local y en remoto. Único pendiente: el informe de la fase 5.0.
- **Producción, consulta de solo lectura del 02/11/2026: los nueve agentes tenían `active = true`.**
  - El seed nunca fijaba `active` (columna con valor por defecto `true`).
  - Una barrera en `claim_next_task` basada solo en `active` no habría protegido nada sin marcar antes a los seis como inactivos. Por eso 0009 lo hace.
- **Modelos en producción**: Daniel, Lucia, David, Emma y Oscar estaban en `claude-opus-5-5`. El registro y el seed los cambian (ver 3).
- Relación tareas–agentes: `tasks.agent_id` → `agents.id`. `delegate_task` ya exigía `agents.active` del destino (0006).

## 2. Catálogo y lista única de activos

| Pieza | Dónde | Cambio |
|---|---|---|
| Definición de los 9 (id, nombre, rol, especialidad, responsabilidades, permisos, modelo, esfuerzo, coordinador, instrucciones) | `src/lib/agents/registry.ts` | Modelos explícitos por agente; ya no usa `DEFAULT_MODEL` |
| **Lista única de activos** | `src/lib/agents/catalog.ts` → `ACTIVE_AGENT_IDS` + `isActiveAgent()` | Nueva. `PILOT_AGENT_IDS` es **la misma lista** (alias de compatibilidad, no una copia) |
| Worker (barrera 1) | `src/lib/engine/worker.ts` | Usa `isActiveAgent` |
| Oficina 3D / lista | `src/lib/office/scene.ts` | `isPilotAgent` deriva de `isActiveAgent` |
| Diagnóstico | `src/app/api/engine/diagnostics/route.ts` | Usa `ACTIVE_AGENT_IDS` |
| Base de datos (barrera 2) | seed + migración 0009 | El seed sincroniza `agents.active` con la lista única; `claim_next_task` lo exige |
| Delegación | `delegate_task` (0006) | Ya rechazaba destinos inactivos. Sin cambios en esta fase |

**Catálogo final:**

| Agente | Rol | Modelo (id técnico) | Esfuerzo | Estado |
|---|---|---|---|---|
| Alex | CEO / Director de operaciones (coordinador) | `claude-sonnet-5-5` | medio | **ACTIVO** |
| Marcus | Director comercial | `claude-sonnet-5-5` | alto | **ACTIVO** |
| Sofia | Directora de marketing | `claude-haiku-5-5` | alto | **ACTIVO** |
| Daniel | Director de contenidos | `claude-haiku-5-5` | medio | inactivo |
| Lucia | Directora creativa | `claude-sonnet-5-5` | medio | inactivo |
| David | Ingeniero de automatización e IA | `claude-sonnet-5-5` | alto | inactivo |
| Emma | Atención al cliente y customer success | `claude-haiku-5-5` | medio | inactivo |
| Oscar | Analista financiero y de datos | `claude-haiku-5-5` | medio | inactivo |
| Victoria | Control de calidad | `claude-sonnet-5-5` | alto | inactivo |

## 3. Modelos: verificación de identificadores

- «Sonnet 5.5» = `claude-sonnet-5-5` y «Haiku 5.5» = `claude-haiku-5-5`.
- Son los identificadores que ya usaba el catálogo con precio (`MODELS`).
- Están **confirmados en uso real**: las tres misiones de producción del 30/10 se ejecutaron con Alex y Marcus en `claude-sonnet-5-5` y Sofia en `claude-haiku-5-5`, con coste liquidado en `ai_usage`.
- No se ha inventado ni actualizado ningún identificador.
- `DEFAULT_MODEL` (`claude-opus-5-5`) se mantiene: solo lo usa `defaultModel()` como respaldo de la variable `DEFAULT_AGENT_MODEL`. Ya ningún agente lo usa.
- **Producción todavía tiene Opus en `agents.model`** de los cinco inactivos. Se corregirá al regenerar y aplicar el seed (`supabase/seed.sql` ya actualizado), lo que requiere autorización.
- Mientras tanto no hay coste posible: el motor toma el modelo del registro, no de la base de datos, y esos agentes no se ejecutan.

## 4. Listas blancas de herramientas (`src/lib/engine/config.ts` → `AGENT_TOOLS`)

| Agente | Habilitadas (`enabled`) | Previstas (`planned`, sin acceso) |
|---|---|---|
| Alex | memory.read, crm.read, content.draft, tasks.delegate | — |
| Marcus | memory.read, crm.read, crm.write, content.draft, web.search, web.fetch | — |
| Sofia | memory.read, crm.read, content.draft | — |
| Daniel | — | memory.read, crm.read, content.draft, web.search |
| Lucia | — | memory.read, content.draft, web.fetch |
| David | — | memory.read, content.draft, web.fetch, n8n.read, n8n.test |
| Emma | — | memory.read, crm.read, crm.write, content.draft |
| Oscar | — | memory.read, crm.read, content.draft, costs.read |
| Victoria | — | memory.read, crm.read, content.draft, quality.review, web.fetch |

- Las listas de Alex, Marcus y Sofia son **idénticas** a las anteriores (`PILOT_TOOLS` ahora deriva de `AGENT_TOOLS`).
- `scopeTools()` devuelve una lista **vacía** para cualquier agente que no esté en `ACTIVE_AGENT_IDS`, aunque alguien rellenara `enabled` por error (probado).
- La ToolGateway sigue siendo la autoridad efectiva: recibe solo el alcance de `scopeTools` y deniega todo lo demás (probado para los 9 agentes y las 21 herramientas).
- **Bloqueadas en esta fase** (`BLOCKED_TOOLS_PHASE_5_1`; una prueba falla si alguna se habilita): email.send, outreach.contact, social.publish, ads.launch, media.generate, n8n.production, data.delete, quality.review, costs.read, n8n.read y n8n.test.

## 5. Migración 0009 (`supabase/migrations/0009_active_agents.sql`)

1. `update public.agents set active = false where id in ('daniel','lucia','david','emma','oscar','victoria') and active;`
   - Es el único cambio de datos.
   - Alex, Marcus y Sofia no se tocan.
2. `create or replace function public.claim_next_task(...)`: **copia literal de la de 0007** con una condición más (diferencia verificada con `diff`: solo 2 líneas):

   ```sql
   and exists (select 1 from public.agents ag where ag.id = x.agent_id and ag.active)
   ```

**Se mantiene**:

- `pg_advisory_xact_lock`;
- la comprobación del presupuesto mensual;
- el máximo de tareas simultáneas;
- `for update skip locked`;
- dependencias, leases, recuperación de tareas abandonadas y límite de reintentos;
- una ejecución por agente.

**No cambia**:

- ni tablas, ni tareas, ni presupuestos, ni RLS, ni políticas, ni permisos;
- tampoco se añaden funciones `SECURITY DEFINER`. `CREATE OR REPLACE` conserva los permisos de ejecución (comprobado con la huella del esquema).

**Marcha atrás**: `supabase/checks/0009_rollback.sql` restaura la función de 0007. Probada: la huella vuelve a ser idéntica.

## 6. Pruebas

| Comprobación | Resultado |
|---|---|
| `tsc --noEmit` | sin errores |
| Vitest completo | **280/280** a la primera (12 nuevas) |
| Navegador (`e2e-office.cjs`) | **17/17** |
| `next build` | OK |
| Paquete del navegador | sin prompts, claves, `__officeCamera` ni configuración interna del motor |

**`tests/migration-0009.test.ts`**:

- **PostgreSQL 17.11 (versión de producción) y 18**, sobre 0001–0008 + seed + los nueve con `active = true`, como en producción.
- **Transaccional**: un fallo a mitad no aplica nada.
- **Datos**:
  - cambian solo `agents.active` de los seis;
  - el resto de columnas de `agents` y **todas las demás tablas quedan idénticas** (md5 por tabla);
  - una tarea previa de Daniel en cola se conserva intacta.
- **Esquema**: solo cambia el cuerpo de `claim_next_task` (misma firma, mismo `SECURITY`, mismos permisos) y no hay ninguna función `SECURITY DEFINER` nueva.
- **Pruebas obligatorias 1–9**: con una tarea por agente, solo Alex, Marcus y Sofia reclaman. Las de los seis quedan en `assigned` con 0 intentos y sin `agent_runs`.
- **10**: una tarea `urgent` y más antigua de Victoria no impide que se reclame la de Marcus.
- **11**: dos workers a la vez sobre una tarea elegible → solo uno la obtiene.
- **12**:
  - B (Sofia) espera a A (Marcus);
  - la tarea con lease no se puede volver a reclamar;
  - con el lease caducado se recupera la **misma** ejecución (`resumed`);
  - al completar A, se reclama B.
- **Contraprueba**: quitando la condición de la migración, la prueba **falla** (los seis reclaman tareas). Comprobado y restaurado.

**`tests/active-agents.test.ts`**:

- 9 agentes con el modelo aprobado y precio conocido.
- Lista única: `PILOT_AGENT_IDS` es la misma lista; la oficina 3D la usa también.
- El seed sincroniza `active`.
- Herramientas idénticas para los tres activos; vacías para los seis, aunque se fuerce su lista.
- Ninguna herramienta bloqueada habilitada; la ToolGateway deniega todo lo que queda fuera del alcance.
- **Barrera de aplicación**: aunque la base de datos dejara pasar la tarea de un inactivo, el worker la falla **sin llamar a Claude ni crear reservas ni gasto**.

**Pruebas anteriores ajustadas**: `engine-db.test.ts` y `concurrency.test.ts` prueban la mecánica general del motor (dependencias, leases, reintentos, aprobaciones y concurrencia) con varios agentes distintos. En **su** base de prueba ahora se activa a todos explícitamente, con un comentario; la barrera se prueba aparte. No se ha relajado ninguna aserción.

## 7. Regresión del piloto (pruebas existentes, todas en verde)

| Área | Pruebas |
|---|---|
| Planificación y delegación de Alex | `pilot-worker` (encargo completo), `pilot-db` (subtareas idempotentes; solo el coordinador, sin subdelegación, máximo por ronda), `engine` |
| Dependencia Sofia → Marcus | `fase3-engine` (el motor la añade siempre; Sofia no empieza mientras Marcus sigue; si Marcus falla, Sofia trabaja con lo que haya) |
| Entregas (`task_deliveries`) | `fase3-engine` (inventario exacto; no se marca «recibida» si la llamada falla) |
| `company_facts` y fichas | `fase3-engine`, `corrections` (fichas reutilizadas, sin duplicados ni más de 5) |
| Memoria | `pilot-worker` (memory__read en las herramientas de Alex), `engine-db` (origen, versiones, ámbito de cliente) |
| Control de coherencia | `fase3-engine` (sección F) |
| Reservas económicas | `budget-recovery` (reserva antes, liquidación real, límites mensual, por misión y por tarea, búsquedas, sobrecoste, lease) |
| Idempotencia y aprobaciones | `engine-db`, `concurrency` (aprobación de un solo uso, argumentos modificados denegados, una sola ejecución en paralelo) |
| Registro de actividad | `pilot-db` (actividad visible sin eventos inventados) |

No se ha ejecutado ninguna misión real.

## 8. Riesgos pendientes

1. **0009 y el seed no están aplicados en producción.** Hasta entonces la única barrera en producción es la del código (worker), que funciona igual que antes. Aplicar requiere autorización y el procedimiento habitual: copia, comprobación previa, una transacción y verificación.
2. **Orden de aplicación recomendado**:
   1. la migración 0009 (marca a los seis como inactivos y endurece `claim`);
   2. después, el seed actualizado (modelos y `active`, idempotente).
3. `authenticated` (el administrador) conserva el permiso `update (model, effort, active)` sobre `agents` (desde 0004). Podría reactivar un agente en la base de datos, pero el worker lo seguiría rechazando (barrera 1). Revisar si se retira en una fase posterior, porque cambiaría permisos.
4. El intermitente conocido de las pruebas con base de datos embebida en paralelo no ha aparecido hoy.

## 9. Archivos

- **Modificados**:
  - `src/lib/agents/catalog.ts`
  - `src/lib/agents/registry.ts`
  - `src/lib/engine/config.ts`
  - `src/lib/engine/worker.ts`
  - `src/lib/office/scene.ts`
  - `src/app/api/engine/diagnostics/route.ts`
  - `src/lib/db/seed.ts`
  - `supabase/seed.sql` (regenerado)
  - `tests/engine-db.test.ts`
  - `tests/concurrency.test.ts`
- **Nuevos**:
  - `supabase/migrations/0009_active_agents.sql`
  - `supabase/checks/0009_rollback.sql`
  - `tests/migration-0009.test.ts`
  - `tests/active-agents.test.ts`
  - `docs/FASE-51-INFRAESTRUCTURA.md`
  - (de la fase 5.0) `docs/FASE-5-DISENO-MULTIAGENTE.md`
- **Eliminados**: ninguno.
- **Sin cambios**: prompts, motor de misiones, ToolGateway, permisos del registro, presupuestos, RLS, variables, autenticación, oficina 3D y retratos.
