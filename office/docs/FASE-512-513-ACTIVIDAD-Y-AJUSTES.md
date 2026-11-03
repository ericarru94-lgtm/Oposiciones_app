# Fases 5.1.2 y 5.1.3 · activity_log y settings

Fecha: 02/11/2026. Estado: **implementado y probado en local y en PostgreSQL aislado (17.11 y 18). No aplicado en producción. Sin commit.**

Las dos migraciones son independientes de 0010. **0012 necesita 0011** (lo comprueba al empezar y se cancela si no está), porque la auditoría de settings solo es infalsificable cuando el navegador ya no puede escribir acciones libres en `activity_log`.

## Fase 5.1.2 · activity_log (`0011_activity_log_hardening.sql`)

**Problema.** El administrador podía insertar filas `admin` con cualquier acción, por ejemplo una que imitara a `agent.config_changed`. Además, `service_role` podía modificar, borrar y vaciar el historial.

**Cambios**
- **Política RESTRICTIVE** «actividad: acciones de la interfaz». Desde `authenticated` solo se pueden insertar:
  - `auth.login`, `mission.created`, `mission.cancelled` y `settings.limits_updated`.
- Se combina con las políticas anteriores, por lo que para insertar hay que cumplir todo esto:
  - ser administrador (PERMISSIVE «admin: añadir actividad»);
  - usar `actor_type = 'admin'` y el propio `auth.uid()` (RESTRICTIVE de 0004);
  - usar una acción de la lista.
- **Solo añadir:**
  - se retiran UPDATE, DELETE y TRUNCATE a anon, authenticated y service_role;
  - dos triggers (`activity_log_append_only` y `activity_log_no_truncate`) lo impiden también al dueño de la tabla.
- Sin SECURITY DEFINER nuevas. La función del trigger no tiene EXECUTE para la API.

**Caminos legítimos probados uno a uno**

| Escritura | Contexto | Resultado |
|---|---|---|
| Las 4 acciones de la interfaz | authenticated (administrador) | ✅ |
| `approval.approved` y `approval.rejected` | `decide_approval`, SECURITY DEFINER | ✅ |
| `approval.consumed` y `approval.use_denied` | `consume_approval`, service_role | ✅ |
| `agent.config_changed` | trigger de 0010, service_role y postgres | ✅ |

**Riesgos que quedan**
- El administrador sigue pudiendo escribir esas 4 acciones con contenido libre en `details`, siempre con su propio id. Son las acciones que ya escribe la interfaz.
- Una operación excepcional, como purgar datos personales, exige una migración que desactive el trigger de forma explícita.
- La guía de restauración de la copia vacía las tablas antes de cargar. Ahora hay que hacerlo con `session_replication_role = replica`, que desactiva los triggers durante la carga (actualizado en `RESTAURACION.md`).

**Marcha atrás:** `supabase/checks/0011_rollback.sql`. Quita los triggers, la función y la política y devuelve los permisos a service_role. No toca ninguna fila.

## Fase 5.1.3 · settings (`0012_settings_hardening.sql`)

**Formato real en producción** (consulta de solo lectura del 02/11/2026):
- `limits = {"monthly_ai_budget_usd": 10, "mission_ai_budget_usd": 1, "task_ai_budget_usd": 1}`
- `pilot = {"agents": ["alex","marcus","sofia"], "max_rounds": 2, "max_subtasks": 6, "max_searches": 15, "max_companies": 5, "stop_on_cost_overrun": true, "synthesis_reserve_usd": 0.25}`
- `confidence_rules`, con las reglas de 0008.
- `notifications = {"approvals": true, "failures": true}`

**Todos cumplen las reglas nuevas: no se sobrescribe nada.** Si un valor guardado no las cumpliera, la migración se cancela entera (probado).

**Cambios**
1. **Techos en una sola fuente:** `settings_ceilings()`. La usan el validador SQL, la acción del servidor y el formulario.
   - límites: 10 $ al mes, 1 $ por misión y 1 $ por tarea;
   - piloto: 2 rondas, 6 subtareas, 15 búsquedas, 5 empresas y 0,25 $ de reserva;
   - agentes: alex, marcus y sofia.
2. **Validación para todos los roles** (también service_role y postgres), con el trigger `settings_guard` y la función pura `settings_value_error()`:
   - `limits`: exactamente los tres importes, numéricos, mayores o iguales a 0, dentro del techo, y tarea y misión no mayores que el mensual. **Nunca `null`.**
   - `pilot`: las claves completas; enteros dentro de los topes actuales (`max_rounds` y `max_subtasks` como mínimo 1); `synthesis_reserve_usd` entre 0 y 0,25 $; `stop_on_cost_overrun` **siempre true**; `agents` solo con agentes aprobados.
   - `notifications`: solo valores sí/no.
   - `limits`, `pilot` y `confidence_rules` no se pueden borrar ni renombrar, y la tabla no se puede vaciar.
3. **Permisos de authenticated:**
   - sin INSERT ni DELETE;
   - UPDATE solo de la columna `value`, y solo en `limits` y `notifications` (RESTRICTIVE «ajustes: solo límites y notificaciones»);
   - `pilot` y `confidence_rules` quedan solo para migraciones y el servidor.
4. **Auditoría:** el trigger `settings_audit` escribe `settings.changed` en cada cambio real, con clave, valor anterior y nuevo, actor verificable (el uid del JWT o «desconocido»), origen y rol del JWT.
   - Es la **única función SECURITY DEFINER nueva**. Tiene que escribir cuando el cambio lo hace el administrador, y con 0011 él no puede usar esa acción, así que nadie puede falsificarla desde el navegador.
   - No tiene EXECUTE para ningún rol de la API.
5. **Base nueva:** si no existe la fila `limits`, se crea con 10/1/1. En producción ya existe y no se toca. El seed también usa 10/1/1 (antes `null`), y no cambia nada donde la fila ya existe.

**Matriz de permisos resultante**

| Clave | Administrador (navegador) | Servidor y migraciones |
|---|---|---|
| `limits` | modificar dentro de los techos (solo bajar o volver al techo) | igual, con las mismas reglas |
| `notifications` | modificar (sí/no) | modificar |
| `pilot` | nada | solo bajar topes; la parada por sobrecoste no se puede desactivar |
| `confidence_rules` | nada | modificar |
| crear, borrar o renombrar claves | nunca | no se pueden borrar `limits`, `pilot` ni `confidence_rules` |

**Formulario y servidor**
- **Formulario:** sin «Sin límite». Los campos son obligatorios, numéricos, con mínimo 0, máximo leído de la base de datos y paso de 0,01. Muestra «Máximo X $» bajo cada campo.
- **Servidor:** `src/lib/domain/limits.ts` aplica las mismas reglas que SQL (probado caso a caso) y lee los techos de `settings_ceilings()`. Si no puede leerlos, no guarda.
- Ahora usa `update` en lugar de `upsert`, porque el navegador ya no puede crear filas, y comprueba que se ha actualizado la fila.
- La base de datos vuelve a validarlo todo, así que saltarse el formulario no sirve.

**Riesgos que quedan**
- El administrador puede **bajar** los límites hasta 0, lo que para la oficina. Es deliberado.
- El servidor (service_role) aún puede cambiar `confidence_rules`. Ningún código lo hace.
- La acción `settings.limits_updated` que escribe la interfaz convive con la fila `settings.changed` del trigger: son dos registros por cada guardado. Es deliberado, para que la interfaz siga funcionando si 0012 no está aplicada.
- La página de tareas aún tiene el texto «sin límite» para el caso `null`, que ya no puede darse con 0012.

**Marcha atrás:** `supabase/checks/0012_rollback.sql`. Quita los triggers, las funciones y la política y devuelve los permisos anteriores (INSERT, UPDATE y DELETE para authenticated).
- No toca valores ni auditoría.
- El código nuevo del formulario necesita `settings_ceilings()`, así que su marcha atrás va aparte.

## Pruebas

- `tests/migration-0011.test.ts` (17.11 y 18): acciones permitidas y prohibidas, los cuatro caminos legítimos, solo añadir para los cuatro roles, historial intacto, marcha atrás y volver a aplicar.
- `tests/migration-0012.test.ts` (17.11 y 18):
  - la migración se cancela con un valor histórico inválido;
  - borrar, vaciar o renombrar falla; `null`, negativos, techos y coherencia se validan para los tres roles;
  - se puede reducir y queda auditado; `pilot` y `confidence_rules` son inmutables desde el navegador;
  - `notifications` sigue siendo editable; no se puede falsificar `settings.changed`;
  - el seed sigue funcionando y el motor aplica los límites (0 $ → no reclama; 10 $ → sí);
  - el validador TypeScript coincide con el SQL; marcha atrás y volver a aplicar.
- `tests/limits.test.ts`: validación del servidor y del formulario.
- **Contrapruebas:** quitando por separado cada protección (3 de 0011 y 5 de 0012), la prueba correspondiente falla.
- **Ensayo sobre la copia real de producción del 02/11** (con 0010): 0 datos cambiados, los valores reales son válidos y las marchas atrás dejan políticas y permisos como tras 0010.
- **Pruebas adaptadas:**
  - `engine-db`, `pilot-db`, `budget-recovery` y `concurrency` retiran `settings_guard` solo en su base de prueba, porque prueban la mecánica del motor con límites de cualquier forma;
  - el inventario de seguridad de `engine-db` incluye las funciones nuevas;
  - `db.test` usa `auth.login`.
