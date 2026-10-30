# Fase 3 · Etapas 2–3: consolidación del motor (A–F) y migración 0008

Estado: **implementado y probado en local**. La migración 0008 **no está aplicada** en Supabase y nada está publicado en Vercel.

## Correcciones
- **A · Marcus continúa.** Tras cada ronda con herramientas web recibe una nota del sistema: el límite de 1 búsqueda y 1 lectura es por llamada, no por tarea. Su mensaje inicial incluye los OBJETIVOS PENDIENTES sacados de las fichas. La lista de herramientas de servidor no cambia entre llamadas.
- **B · Sofia depende de Marcus.** Lo impone el motor (`PILOT_DEPENDENCIES` en `config.ts`), aunque Alex no lo pida o delegue a Sofia primero. Si Marcus falla, Sofia se ejecuta igual con las fichas y el estado de fallo. Mientras Marcus siga en marcha (reintento programado), Sofia espera.
- **C · Registro de entregas (`task_deliveries`).** Para cada mensaje inicial: emisor, receptor, IDs y versiones de fichas y documentos, y lo que se recortó. Estados: *preparada* (antes de reservar), *enviada* (la llamada salió y falló), *recibida* (la API respondió y el coste quedó registrado). Sin llamada, nunca pasa de *preparada*. Alex recibe el INVENTARIO DE ENTREGAS exacto.
- **D · Estados de resultado.** Cada subtarea cierra con un bloque `resultado` (JSON). Estados posibles: completada, completada con avisos, parcialmente completada y fallida. Sin declaración válida queda «con avisos»: una ejecución terminada no equivale a objetivos completados.
- **E · Procedencia (`company_facts`).** Hechos inmutables con fuente, tipo de fuente, fecha de consulta (`observed_at`, la pone la base de datos), estado de verificación, confianza y motivo. Sustituir un hecho conserva el anterior (`supersedes_fact_id`). Dos valores distintos para el mismo dato quedan registrados y marcados como contradicción.
- **F · Control de coherencia.** Al terminar, el sistema compara el informe de Alex con la realidad. Detecta tres casos: niega empresas que existen, cita IDs inexistentes u omite una subtarea fallida. Si encuentra algo, la misión queda «con avisos» y el informe lleva la sección «Control automático de coherencia (sistema)».

## Regla de confianza (puntuaciones de clasificación, no probabilidades)
La regla está guardada en `settings.confidence_rules` y es configurable sin desplegar.

| Fuente | Puntos |
|---|---|
| Web oficial, confirmación directa | 95 |
| Fuente oficial indirecta | 90 |
| Directorio especializado actualizado | 80 |
| Tercero externo | 70 |
| Autodeclarado | 60 |
| Inferencia razonable | 40 |
| Sin fuente verificable | 0 |

- Antigüedad de la fuente: −10 si tiene más de 365 días y −20 si tiene más de 730.
- El agente solo puede **bajar** la puntuación, y con motivo. Si pide subirla, se ignora.
- Toda fuente que no sea `none` ni `inference` necesita URL.

## Migración 0008 (`supabase/migrations/0008_deliveries_facts_realtime.sql`)
- Tablas `company_facts` (inmutable por trigger) y `task_deliveries`, y vista `company_facts_current` (`security_invoker`).
- RLS solo de lectura para el administrador.
- Funciones nuevas solo para `service_role`: `fact_confidence`, `record_company_fact`, `advance_deliveries`. No hay SECURITY DEFINER nuevas.
- Se quita a `authenticated` la escritura en `documents` y `task_dependencies`. La interfaz solo las lee y las escribe el motor con `service_role`.
- Realtime: se añaden `companies`, `documents`, `ai_usage`, `tool_executions`, `task_deliveries` y `company_facts`.
- Probada sobre 0001–0007 con datos (`tests/migration-0008.test.ts`): es transaccional, no toca datos y es compatible con el código publicado (01432bd) para hacer rollback de Vercel.

## Pruebas
- 152 en verde (16 archivos) y build correcto.
- Nuevas: `tests/fase3-engine.test.ts` (14) y `tests/migration-0008.test.ts`.
