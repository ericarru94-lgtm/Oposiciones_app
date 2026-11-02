# Fase 5.1.1 · Endurecimiento de la configuración de agentes

Fecha: 02/11/2026. Estado: **implementado y probado en local y en PostgreSQL aislado (17.11 y 18). No aplicado en producción. Sin commit.**

Archivos:
- `supabase/migrations/0010_agent_config_hardening.sql`: migración nueva (no toca 0001–0009).
- `supabase/checks/0010_rollback.sql`: marcha atrás.
- `tests/migration-0010.test.ts`: pruebas obligatorias 1–13.
- Pruebas adaptadas: `engine-db`, `concurrency` y `active-agents`.

## 1. Situación de partida (auditada en producción, solo lectura)

**Tabla `agents`**
- `authenticated` tenía SELECT en la tabla y UPDATE solo en las columnas `model`, `effort` y `active` (0004, líneas 35–36). `anon` no tenía nada.
- La política RLS «admin: acceso completo» (`is_admin()`) limita ese UPDATE al administrador.
- El riesgo: con su sesión, el administrador podía activar a cualquier agente desde el navegador. Se comprobó en la base aislada.
- Ninguna pantalla ni acción del código usa ese permiso. Los modelos que usa el motor salen del código (registry), no de la base de datos.

**Tabla `settings`**
- `authenticated` tiene INSERT, UPDATE, DELETE y SELECT, también bajo `is_admin()`.
- `settings.pilot.agents` (`["alex","marcus","sofia"]`, creado en 0006) lo puede editar el administrador.
- Lo leen `delegate_task` y el motor (`max_companies`, `max_searches`, `synthesis_reserve_usd`). El seed no lo escribe.
- **Conclusión: no es una fuente de verdad fiable** para proteger la activación. Por eso no se usa.

**Tabla `activity_log`**
- Columnas: `id`, `actor_type` (`admin`, `agent` o `system`), `actor_id`, `action`, `entity_type`, `entity_id`, `details` (jsonb) y `created_at`.
- `authenticated` solo puede insertar filas con `actor_type = 'admin'` y `actor_id = auth.uid()` (políticas de 0001 y 0004).
- No puede modificar ni borrar filas (0001).

## 2. Protección de activación

La restricción CHECK `agents_active_aprobados` queda así:

```sql
check (not active or id in ('alex', 'marcus', 'sofia'))
```

- **Es la única autoridad en la base de datos.** Afecta a todos los roles (authenticated, service_role y postgres), y también al seed y a las restauraciones.
- Cambiar la lista exige una migración nueva. Ningún rol de la API puede quitar la restricción, porque no es dueño de la tabla.
- **No depende de `settings`.** Aunque el administrador añada a Daniel a `settings.pilot.agents`, Daniel no se puede activar (probado). La delegación tampoco puede usarlo, porque `delegate_task` también exige que el agente esté activo.
- **Coincide con `ACTIVE_AGENT_IDS`** (`src/lib/agents/catalog.ts`):
  - una prueba falla si las dos listas difieren;
  - si alguien activa a otro agente solo en el código, el seed falla en lugar de activarlo en la base de datos.
- Desactivar a un agente aprobado sigue permitido, y queda auditado.

## 3. Auditoría

La función `log_agent_config_change()` es SECURITY INVOKER (sin SECURITY DEFINER nuevas), con `search_path = ''`. Se retira su permiso de ejecución a public, anon y authenticated.

Dos triggers AFTER:
- `agents_config_audit`, en UPDATE OF active, model y effort. Solo se dispara si alguno cambia de verdad (`is distinct from`).
- `agents_config_audit_insert`, en INSERT, para las altas de agentes.

Reglas del registro:
- **Una fila por operación**, con todos los campos cambiados juntos. Una actualización sin cambios reales no genera nada, incluido el seed cuando no cambia nada.
- **Actor:** solo se identifica si hay un JWT de usuario validado por la API (`rol_jwt = authenticated` con `sub`). En cualquier otro caso queda `actor_type = 'system'`, `actor_id = null` y `"actor": "desconocido"`; nunca se inventa.
  - `auth.uid()` no se usa para service_role.
- **Origen:**
  - `api (service_role: servidor de la oficina)`;
  - `sql directo (migración, seed o editor SQL)`, cuando es postgres sin JWT;
  - `api (usuario autenticado)`;
  - `desconocido`, que incluye un JWT ilegible.
- **No se guardan datos sensibles:** ni prompts, ni instrucciones, ni JWT completos. Solo los nombres de los roles.
- **No falsificable desde authenticated:** no puede crear filas `system`, ni con el `actor_id` de otro usuario, ni modificar o borrar filas, ni ejecutar la función (todo probado).

Ejemplos reales de la prueba:

```json
{"actor_type":"system","actor_id":null,"action":"agent.config_changed","entity_type":"agent","entity_id":"alex",
 "details":{"cambios":{"model":{"antes":"claude-sonnet-5-5","despues":"claude-haiku-5-5"}},
            "actor":"desconocido","origen":"api (service_role: servidor de la oficina)",
            "rol_bd":"service_role","rol_jwt":"service_role","registrado_por":"trigger agents_config_audit (0010)"}}

{"actor_type":"system","actor_id":null,"action":"agent.config_changed","entity_id":"alex",
 "details":{"cambios":{"model":{"antes":"claude-haiku-5-5","despues":"claude-sonnet-5-5"},
                       "effort":{"antes":"medium","despues":"high"}}, "…": "…"}}

{"actor_type":"system","actor_id":null,"action":"agent.config_changed","entity_id":"sofia",
 "details":{"cambios":{"active":{"antes":true,"despues":false}},
            "origen":"sql directo (migración, seed o editor SQL)","rol_bd":"postgres","rol_jwt":null, "…": "…"}}
```

## 4. Permisos antes y después

Las tres filas de permisos que retira la migración:

| Permiso | Antes | Después |
|---|---|---|
| `agents.model` · authenticated · UPDATE | sí | **no** |
| `agents.effort` · authenticated · UPDATE | sí | **no** |
| `agents.active` · authenticated · UPDATE | sí | **no** |

Todo lo demás sigue igual:
- SELECT de `agents` para authenticated;
- service_role y postgres;
- `settings` y `activity_log`;
- las 27 políticas y RLS en las 24 tablas;
- las 3 funciones SECURITY DEFINER.

Lo único que se añade es la restricción, la función y los dos triggers.

## 5. Marcha atrás

`supabase/checks/0010_rollback.sql` va en una transacción. Hace tres cosas:
- borra los dos triggers y la función;
- quita la restricción;
- vuelve a conceder `update (model, effort, active)` a authenticated, igual que en 0004.

Probado: tras aplicarla, la huella del esquema y los permisos por columna quedan idénticos a los de después de 0009, y se puede volver a aplicar 0010.

**Lo que no se revierte:**
- Las filas de auditoría se conservan a propósito. Se localizan con `action in ('agent.config_changed', 'agent.created') and actor_type = 'system'`.
- Los cambios de agentes hechos mientras 0010 estuvo aplicada no se deshacen.

## 6. Riesgos pendientes

1. **El administrador aún puede escribir `activity_log` con `actor_type = 'admin'` y su propio `actor_id`**, incluida una acción con el nombre `agent.config_changed`. No puede hacerse pasar por el sistema ni por otro usuario. Los registros auténticos del trigger se distinguen por `actor_type = 'system'`. Cerrarlo del todo exige una política RLS nueva, y eso no está autorizado aquí.
2. **`settings` sigue siendo editable por el administrador** (`pilot`, `limits`). Ya no sirve para activar agentes, pero sí cambia `max_rounds`, `max_subtasks`, `max_searches`, `max_companies` y `synthesis_reserve_usd`. Conviene revisarlo en otra fase.
3. **El actor de las operaciones de service_role no se puede identificar en la base de datos.** Queda como «desconocido» con su origen. Si se quiere más detalle, tendría que mandarlo el servidor (cambio de código).
4. **Activar a un séptimo agente en el futuro exige una migración nueva** que cambie la restricción. Es deliberado.
5. **Al crear una base nueva**, el seed inserta los 9 agentes y genera 9 filas `agent.created`. En producción los agentes ya existen, así que no se genera ninguna.

## 7. Aplicarla en producción (cuando se autorice)

1. Hacer una copia y verificarla con el procedimiento de `/root/he-signal-backups`.
2. Aplicar 0010 en una transacción. En el ensayo sobre la copia real de producción del 02/11 no cambió ningún dato y la restricción quedó validada.
3. Comprobar que:
   - no hay UPDATE por columna en `agents` para authenticated;
   - la restricción existe y está validada;
   - los dos triggers existen;
   - las políticas, la RLS y las SECURITY DEFINER tienen la misma huella;
   - todas las tablas conservan su md5.
4. No hace falta volver a ejecutar el seed.
