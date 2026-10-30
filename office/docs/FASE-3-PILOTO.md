# Fase 3 · Piloto con Claude: Alex, Marcus y Sofia

Estado: preparado, sin activar. Ya hecho: cliente real de Claude (`src/lib/engine/anthropic.ts`), bucle manual, puerta de herramientas con aprobaciones e idempotencia, motor en base de datos, costes y límites.

## Alcance del piloto

| Agente | Qué podrá hacer | Herramientas activas |
|---|---|---|
| Alex | Recibir tu encargo, dividirlo y delegar en Marcus y Sofia, recopilar y entregarte un plan | memoria, delegar tareas, informe, borrador |
| Marcus | Investigar gimnasios reales con fuentes, preparar fichas del CRM en borrador y mensajes de prospección | memoria, búsqueda y lectura web, CRM (lectura y borrador), borrador |
| Sofia | Estrategia de captación y experimentos con coste estimado | memoria, búsqueda web, borrador |

Siguen **desconectadas** (los agentes lo dirán, no lo simularán): enviar emails, contactar empresas, publicar, campañas, generar imágenes, n8n.

## Qué se construye

1. `SupabaseEnginePort`: implementación real de `EnginePort` con las funciones del motor (clave secreta, solo servidor).
2. `/api/engine/tick`: ejecuta pasos de hasta ~240 s; protegido con `ENGINE_TICK_SECRET` (comparación en tiempo constante).
3. Latido gratuito: `pg_cron` + `pg_net` en Supabase llaman al tick cada minuto (secreto guardado en Supabase Vault).
4. Herramientas del piloto con validación de entrada (zod): `memory.read` (vía `memory_for_task`), `content.draft` (guarda en `documents`), `crm.read`, `tasks.delegate` (subtareas con clave de idempotencia y dependencias), `tasks.report`, `web.search` / `web.fetch` (herramientas oficiales de Anthropic).
5. Interfaz: asignar tarea a un agente, bandeja de aprobaciones, detalle de tarea con resultado, coste y documentos, chat con Alex.
6. Pruebas: bucle con modelo simulado sobre la base de datos real local, y una prueba controlada con Claude real limitada a céntimos.

## Modelos propuestos para el piloto

| Agente | Modelo | Motivo |
|---|---|---|
| Alex | Claude Sonnet 5.5 | Coordina y redacta el plan final |
| Marcus | Claude Sonnet 5.5 | Investigación con criterio |
| Sofia | Claude Haiku 5.5 | Primeras estrategias baratas; se sube si se queda corta |

Coste estimado del piloto: un encargo completo ≈ 0,30–0,60 $. Con un límite de 10 $/mes en la oficina, unos 20–30 encargos.

## Lo que necesito de ti

1. **Autorización para aplicar la migración `0005`** en Supabase.
2. **Clave de la API de Anthropic** (platform.claude.com → API Keys) con un **tope de gasto** fijado allí (p. ej. 15 $/mes). La añades tú en Vercel → Settings → Environment Variables como `ANTHROPIC_API_KEY` (tipo «Sensitive»), o me autorizas a hacerlo.
3. **Clave secreta de Supabase** (`sb_secret_…`, Project Settings → API Keys) como `SUPABASE_SECRET_KEY` en Vercel («Sensitive»). No puedo leerla con mi conexión.
4. Límite mensual en Configuración de la oficina (propuesta: 10 $) y confirmar los modelos de la tabla.

---

## Estado de la implementación (30/10/2026)

Implementado y probado en local (106 pruebas, `npm run check` y `npm run build` en verde). **Pendiente de autorización**: aplicar la migración `0006_pilot_engine.sql` en Supabase y publicar en Vercel.

| Pieza | Archivo |
|---|---|
| Configuración central (modelos, límites, herramientas del piloto) | `src/lib/agents/registry.ts`, `src/lib/engine/config.ts` |
| Cliente real de Claude, sin respaldo automático de modelo | `src/lib/engine/anthropic.ts` |
| Acceso a datos del motor (Supabase y SQL para pruebas) | `src/lib/engine/store*.ts` |
| Herramientas reales: memoria, CRM con fuentes, borradores, delegación | `src/lib/engine/pilot-tools.ts` |
| Instrucciones del piloto y mensajes de cada fase | `src/lib/engine/pilot-prompts.ts` |
| Ejecutor (pasadas de ≤ 280 s con reserva de tiempo) | `src/lib/engine/worker.ts` |
| Rutas solo para el administrador | `POST /api/engine/tick`, `GET /api/engine/diagnostics` |
| Pantallas | `/tareas` (nuevo encargo e historial), `/tareas/[id]` (equipo, coste, informe, documentos, fichas, actividad) |

Cómo se ejecuta un encargo:
1. Creas el encargo en `/tareas` (va a Alex, fase de planificación).
2. Al abrirlo, la página pide pasadas del motor mientras haya trabajo. **Si cierras la página, el trabajo se pausa** (no hay ejecución en segundo plano: el cron de Vercel Hobby solo permite una ejecución al día; pg_cron requeriría otra autorización).
3. Alex delega en Marcus y Sofia (Sofia depende de Marcus) y espera; cuando terminan, vuelve en fase de síntesis y entrega el informe final, que se guarda como documento.

Garantías comprobadas en `tests/pilot-worker.test.ts`:
- Modelos y esfuerzo de cada agente salen de la configuración central; la web solo la tiene Marcus.
- Herramientas bloqueadas (email, contactar, publicar, campañas, n8n, gastar, borrar) y la subdelegación se rechazan sin ejecutarse.
- Cada ficha del CRM exige URL de fuente y no admite emails; no se duplica.
- Coste por llamada en `ai_usage`, búsquedas web contadas aparte, coste por tarea en `task_costs`.
- Al superar el límite por tarea o mensual, la tarea se detiene tras el paso ya pagado y sus subtareas se cancelan sin llamar al modelo.
- Si una pasada se queda sin tiempo, guarda el estado y la siguiente continúa la misma ejecución.
- Volver a ejecutar no repite nada (delegaciones, fichas y documentos idempotentes).
