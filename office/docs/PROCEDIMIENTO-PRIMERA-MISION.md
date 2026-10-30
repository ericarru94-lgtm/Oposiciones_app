# Procedimiento · migración 0007, publicación y primera misión real

Preparado el 30/10/2026. **Nada de esto se ejecuta sin la autorización explícita del administrador.**

**Estado (30/10, con autorización):** pasos 1–3 hechos. Comprobación previa limpia (hasta 0006, 0 tareas, 0 empresas, 0 gasto); 0007 aplicada como `budget_reservations` y verificada; versión 707978d publicada (`dpl_4gjGYrL745V8DUVpVTJjp7iV3gwC`). Pendientes: pasos 4–8 (administrador). Cada paso indica quién lo hace y cómo se comprueba.

## Condiciones aprobadas para la primera misión
- Búsqueda web activada **solo para Marcus** (versiones básicas, 1 búsqueda + 1 lectura por llamada).
- Máximo **5 gimnasios** (lo impone la base de datos) y **15 búsquedas** por misión.
- **1 $ por misión** (0,25 $ reservados siempre para el informe de Alex), 1 $ por tarea, 10 $ al mes. No se amplía ningún límite para completar la misión.
- Sin emails, llamadas, mensajes, publicaciones, campañas, n8n ni contacto con empresas: esas herramientas no tienen manejador y se rechazan.
- **Sobrecoste (`cost_overrun`) → la misión entera se detiene automáticamente** y queda constancia (evento, error de la misión y coste registrado). Ajuste `pilot.stop_on_cost_overrun = true`.
- Las llamadas inciertas nunca se repiten automáticamente.
- Todo el resultado queda en borrador.

## Paso 1 · Comprobaciones previas (Claude, solo lectura)
```sql
select name from supabase_migrations.schema_migrations order by version;      -- llega hasta 0006
select to_regclass('public.ai_reservations');                                 -- null
select value from public.settings where key in ('limits', 'pilot');
select count(*) from public.tasks;                                            -- sin misiones en curso
```
Si hay alguna misión en curso, se para el procedimiento.

## Paso 2 · Aplicar la migración 0007 (Claude, con autorización)
- Una sola migración (`budget_reservations`), en una transacción: si algo falla, no se aplica nada. No añade valores de enum, así que no hace falta dividirla.
- Contenido: `supabase/migrations/0007_budget_reservations.sql` del commit publicado.

Verificación inmediata:
```sql
select to_regclass('public.ai_reservations') is not null as reservas;
select value from public.settings where key = 'limits';   -- añade "mission_ai_budget_usd": 1, sin tocar el resto
select value from public.settings where key = 'pilot';    -- max_companies 5, max_searches 15, synthesis_reserve_usd 0.25, stop_on_cost_overrun true
select p.proname, has_function_privilege('authenticated', p.oid, 'execute') as admin, has_function_privilege('service_role', p.oid, 'execute') as servidor
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('reserve_budget','record_call','close_reservation','save_run_state','defer_run','cancel_mission','committed_usd','mission_of');
                                                         -- admin = false, servidor = true en todas
select count(*) from public.companies;                    -- igual que antes
```
Más el informe de seguridad de Supabase (`get_advisors`): solo los 2 avisos conocidos e intencionados.

## Paso 3 · Publicar en Vercel (Claude, con autorización)
- Versión: el commit de la rama `ccr-30b91845-834xuv` que se indique al autorizar (código y migración ya probados juntos).
- Comprobar estado `READY` y que `he-signal-office.vercel.app` apunta a la nueva versión.
- **Vuelta atrás**: volver a publicar la versión anterior (`dpl_7LtExYMoFKXAo4A3tC5xazEnSJkt`, commit b6c8bf1). La 0007 puede quedarse: el código anterior funciona con ella (probado).

## Paso 4 · Diagnóstico de modelos (administrador, sin coste)
Abrir con la sesión iniciada: `https://he-signal-office.vercel.app/api/engine/diagnostics`
- Debe salir `"ok": true` con `claude-sonnet-5-5` y `claude-haiku-5-5` disponibles.
- Si sale `false`, no se lanza la misión.

## Paso 5 · Revisar la configuración en la app (administrador)
- **Configuración**: mensual 10 · por tarea 1 · por misión 1. No cambiar.
- **Encargos**: debe mostrar «Gastado o reservado este mes: 0,00 $ de 10,00 $ · por misión 1,00 $ · por tarea 1,00 $ · máx. 5 empresas».

## Paso 6 · Lanzar la misión (administrador)
1. **Encargos** → «Rellenar con la misión del piloto» → «Crear encargo».
2. **Mantener la página abierta** (móvil desbloqueado o portátil). Cerrarla pausa el trabajo sin perder nada; al volver se reanuda.
3. Duración estimada: 10–20 minutos.

## Paso 7 · Durante la misión: qué mirar
| Ves | Significa | Qué hacer |
|---|---|---|
| «Trabajando ahora» | Hay una tarea con lease vigente | Nada |
| «Esperando a que el equipo termine» | Alex espera a Marcus/Sofia | Nada |
| «En espera: reintento a las HH:MM» | Error transitorio sin cobro (429/529/503) | Esperar |
| «En pausa: hay trabajo listo» | La página estuvo cerrada o en segundo plano | Pulsar «Reanudar ahora» |
| «Detenida: …sobrecoste…» | Una llamada costó más que su reserva | Nada se repite. Avisar a Claude con una captura |
| «Detenida: …incierto…» en una subtarea | Llamada sin respuesta: cuenta como gastada | No reintentar. Alex informa con lo que haya |
| Algo que no te gusta | — | «Detener misión» (las llamadas en curso cuentan como gastadas) |

## Paso 8 · Después (Claude, solo lectura)
```sql
-- Coste real de la misión, separado
select sum(claude_cost_usd) claude, sum(search_cost_usd) busquedas, sum(cost_usd) total, sum(server_tool_requests) n_busquedas
  from public.ai_usage where task_id in (select id from public.tasks where id = :mision or parent_task_id = :mision);
-- Reservas: ninguna abierta; inciertas y sobrecostes, si los hay
select status, count(*), sum(estimate_usd), sum(actual_usd) from public.ai_reservations where mission_id = :mision group by status;
select type, message from public.task_events where type in ('cost_overrun', 'cancelled', 'failed', 'timed_out') and task_id in (select id from public.tasks where id = :mision or parent_task_id = :mision);
-- Fichas: máximo 5, todas con fuente
select name, source from public.companies where created_in_task in (select id from public.tasks where id = :mision or parent_task_id = :mision);
```
- Conciliar el total con la consola de Anthropic (Usage) del día.
- Informe al administrador: coste real (Claude / búsquedas), nº de llamadas, fichas con fuentes, documentos, incidencias, y si el coste real se ajusta a lo previsto.
- Las fichas y los documentos son borradores: nadie contacta con ninguna empresa.
