# Fase 3 · Preparación controlada de producción (31/10/2026)

Estado: **todo en local; nada aplicado ni publicado.** La auditoría de producción se hizo solo con consultas de lectura (lista de migraciones, catálogo, recuentos, avisos de seguridad). Producción sigue en `01432bd` y sin la 0008.

## 1. Commits y cambios
Esta fase parte de `ab308ac` (final de la fase 3). El commit final es el de este documento.

| Commit | Cambio |
|---|---|
| `f5c46d1` | `zod` 4.3.3 → **4.6.6** (versión exacta). Contrato de validación fijado en `tests/zod-contract.test.ts` y sus *snapshots*. `source_date` exige una fecha real y no futura. |
| (este) | Prueba de la 0008 en **PostgreSQL 17.11**, la versión de producción, además de la 18. Prueba de aditividad por huella del esquema. Marcha atrás de emergencia probada. Herramientas de comparación con producción. Este informe. |

Archivos nuevos:
- `supabase/checks/schema-fingerprint.sql` y `schema-fingerprint-summary.sql`: huella del esquema, solo lectura.
- `supabase/checks/0008_rollback.sql`: marcha atrás de emergencia; no es una migración.
- `scripts/schema-fingerprint.mts`.
- `tests/zod-contract.test.ts`.

Dependencia nueva solo de desarrollo: `embedded-postgres-17` (alias de `embedded-postgres@17.11.0-beta.19`). Sirve para probar sobre la misma versión que producción y no se incluye en el despliegue.

## 2. Zod
- **Versión final: 4.6.6**, fijada. Integridad verificada con el registro de npm (`sha512-4UmzQUF5…/UhA==`). `npm audit --omit=dev`: **0 vulnerabilidades**.
- **Vulnerabilidad corregida:** GHSA-mrhx-c7xc-m3w5 / CVE-2023-54404 (alta, CVSS 8,2). Al validar un array, zod acumulaba un error por cada elemento erróneo aunque el array superara su máximo, y eso permitía agotar la memoria. La corrección (commit `a0ebf97`, PR #6652) comprueba el tamaño antes de validar los elementos.
- **Efecto en nuestro código:** todos nuestros arrays ya tenían `.max()`, pero con 4.3.3 un array de 5.000 elementos en `crm.write.facts` generaba **20.000 errores** antes de rechazarse. Con 4.6.6 genera **1** (`too_big`). Está cubierto por una prueba.
- **Por qué 4.6.6 y no 4.6.7:** 4.6.6 es la versión parcheada que cita el aviso. 4.6.7 no tiene cambios publicados más allá del número de versión.
- **Changelog revisado** (4.4–4.6.7):
  - Cambios de comportamiento en 4.6.0: los mapas de error se evalúan al leer `error` (no cambiamos `z.config`) y `z.emoji()` es más estricta (no la usamos).
  - Ninguno afecta a nuestros esquemas.
  - `@anthropic-ai/sdk` acepta `^3.25 || ^4` y usa la misma copia (deduplicada).
  - En el lockfile solo cambia `zod`.
- **Esquemas sin alterar:** el JSON Schema que se envía a Claude por cada herramienta es **idéntico byte a byte** al de 4.3.3, y las 17 entradas de prueba se aceptan o rechazan igual. Los dos *snapshots* se generaron con 4.3.3 y pasan con 4.6.6.
- **Corrección añadida:** `source_date` aceptaba fechas imposibles (`2026-13-40`) y futuras. Ahora se rechazan. El JSON Schema no cambia.

## 3. Estado exacto de las migraciones
Producción (`bgptbtmyhtobqohkoeyd`, **PostgreSQL 17.11**) tiene 9 entradas en `supabase_migrations.schema_migrations`. El repositorio tiene 7 archivos (0001–0007) más la 0008 sin aplicar. **La discrepancia «nueve frente a siete» se explica porque la 0004 y la 0006 se aplicaron en dos partes cada una:**

| Archivo local | sha256 (inicio) | Producción (versión · nombre) |
|---|---|---|
| 0001_init | 3c8abca6 | 20261030104320 · init |
| 0002_admin_allowlist | baaf3a27 | 20261030104503 · admin_allowlist |
| 0003_security_hardening | 430b5fd4 | 20261030104523 · security_hardening |
| 0004_engine_approvals_documents | e395ec67 | 20261030123903 · engine_approvals_part1 **+** 20261030124049 · documents_memory_costs_part2 |
| 0005_hardening_idempotency | 06a6c77a | 20261030130930 · hardening_idempotency |
| 0006_pilot_engine | 652bf3dc | 20261030141750 · pilot_engine_part1_states **+** 20261030141853 · pilot_engine_part2_functions |
| 0007_budget_reservations | 009c6f16 | 20261030150351 · budget_reservations |
| **0008_deliveries_facts_realtime** | **bad13309** | **no aplicada** (`company_facts` y `task_deliveries` no existen) |

**Hashes:** los textos aplicados no coinciden byte a byte con los archivos, porque las partes se aplicaron sin los comentarios. Por eso comparé el **esquema resultante** con una huella del catálogo `public` que cubre:
- columnas, restricciones, índices, políticas y RLS;
- funciones (código, SECURITY DEFINER, `search_path`) y permisos de ejecución por rol;
- grants por rol, triggers, publicación de Realtime, enums, vistas y claves de `settings`.

Resultado (producción frente a 0001–0007 en local, sobre PostgreSQL 17.11):
- **12 de 13 categorías idénticas**, con 748 elementos en ambos lados.
- **`fn` difiere en 6 funciones:** `approvals_guard`, `companies_mission_quota`, `decide_approval`, `delegate_task`, `record_call` y `reserve_budget`. Si se quitan comentarios y espacios, su código es **idéntico** (hash normalizado igual en las 6). Solo cambian los comentarios internos.
- PostgreSQL 18 registra los NOT NULL como restricciones y la 17 no. La huella las excluye para poder comparar.
- **Conclusión: el esquema de producción es exactamente el de 0001–0007. No hay cambios manuales ni objetos de más o de menos.**

Datos en producción (solo recuentos): 9 tareas, 5 fichas, 6 documentos, 29 costes, 30 reservas (todas liquidadas o liberadas), 7 dependencias y 12 ejecuciones. **0 ejecuciones activas y 0 tareas bloqueadas.**

## 4. Compatibilidad de la 0008
- **Aditiva:** prueba automática con la huella del esquema antes y después, en PostgreSQL 17.11 y 18.
  - Solo desaparecen los permisos de escritura de `authenticated` en `documents` y `task_dependencies`, y es intencionado.
  - No cambia ninguna función, tabla, política, índice ni restricción existente.
  - Se añaden 2 tablas, 1 vista, 4 funciones, 1 trigger, 8 índices, 2 políticas, 6 tablas de Realtime y 1 clave en `settings`.
- **Sin pérdida de datos:** el md5 de todas las filas de **todas** las tablas anteriores es idéntico antes y después. En `settings` solo se añade `confidence_rules`.
- **Transaccional:** si falla a mitad, no queda nada, ni datos ni esquema. Si se reaplica por error, falla limpio sin cambiar nada.
- **Sin exposición adicional por RLS:**
  - Las tablas nuevas tienen RLS de solo lectura para el administrador (`is_admin()`). `anon` no tiene nada; `authenticated` solo `SELECT`.
  - La vista usa `security_invoker`.
  - Las funciones nuevas son solo para `service_role`, con `search_path` vacío. No hay SECURITY DEFINER nuevas.
  - `anon` no puede ejecutar ninguna función.
- **Código publicado (`01432bd`) con la 0008:** ejecuté su propia batería de pruebas sobre las migraciones 0001–0008 y pasan **136 de 137**.
  - La que falla comprobaba que el administrador podía insertar documentos, que es justo el permiso que retira la 0008. El código de esa versión nunca lo hace: solo lee `documents`, y las escrituras las hace el motor con `service_role`.
  - El flujo SQL completo del código anterior también funciona sobre la 0008 (prueba automática): reclamar, reservar, registrar coste, guardar documento, añadir dependencia y terminar.
- **El código nuevo exige la 0008.** Registra entregas y hechos. Por eso el orden es: primero la migración y después el despliegue. Durante el intervalo entre ambos funciona el código anterior.
- **Marcha atrás:** `supabase/checks/0008_rollback.sql` deja el esquema **idéntico** al de la 0007 (prueba automática en las dos versiones). Borra los hechos y entregas registrados después de la 0008 y no toca ningún dato anterior. Solo debe usarse con autorización; normalmente basta con volver al código anterior.

## 5. Resultado de las pruebas
| Prueba | Resultado |
|---|---|
| Todas las automáticas (`vitest`) | **165 / 165** en 18 archivos |
| TypeScript (`tsc --noEmit`, estricto) | OK |
| Build de producción (`next build`) | OK |
| Migraciones: 0007 (PG 18) y 0008 (**PG 17.11** y PG 18) | 1/1 y 2/2 |
| Seguridad (`engine-db` 40, `app-security` 5, `pilot-db` 8, `env` 4) | 57/57 |
| Coordinación A–F (`fase3-engine`) | 14/14 |
| Reservas y costes (`budget-recovery` 13, `concurrency` 5, `corrections` 13, `pilot-worker` 3) | 34/34 |
| Contrato zod | 4/4 |
| Realtime simulado y escena (`office`) | 8/8 |
| Código anterior `01432bd` con la 0008 | 136/137 (la única que falla es la del permiso retirado a propósito, ver punto 4) |
| Playwright, escritorio y móvil (`scripts/e2e-office.cjs`) | **17/17** |
| `npm audit --omit=dev` | 0 vulnerabilidades |
| Lint | Ver más abajo |

**Lint:** el proyecto no tiene linter configurado (Next 16 ya no trae `next lint`). Ejecuté ESLint 9 aparte, sin añadirlo al proyecto, con las reglas recomendadas de TypeScript, React Hooks y Next: 40 avisos, **ninguno de seguridad ni de lógica**.
- 24 son variables globales no declaradas en el guion de Playwright: a la configuración temporal le faltaban las de Node y el navegador.
- 11 vienen de una función auxiliar de las pruebas llamada `use()`, que la regla confunde con el hook de React.
- 5 son menores e intencionados: un `_` para descartar un campo, una directiva sobrante, un patrón de regex en una prueba, y un `setState` en `useEffect` para detectar WebGL y el tamaño de pantalla tras la hidratación.

Recomendación: añadir ESLint al proyecto en una fase propia.

## 6. Seguridad (auditoría)
- **`company_facts` y `task_deliveries`:**
  - RLS activado.
  - Una política `SELECT` para `authenticated` con `is_admin()`.
  - Sin políticas de escritura. Los grants de escritura están retirados a `authenticated` y `anon`.
  - `company_facts` no se puede modificar (trigger).
- **Grants:**
  - `authenticated` solo ejecuta `ai_budget_status`, `decide_approval` e `is_admin`.
  - Las funciones del motor son solo para `service_role`, que conserva todos sus permisos.
- **Avisos de Supabase en producción** (anteriores y sin cambios):
  - 2 SECURITY DEFINER ejecutables por `authenticated` (`decide_approval` e `is_admin`): intencionados y documentados desde la 0005.
  - «Protección contra contraseñas filtradas» desactivada. Es un ajuste de Auth, no del código; recomendado activarlo (requiere decisión y posiblemente un plan de pago de Supabase).
- **Realtime:**
  - La oficina usa un solo canal con la sesión del administrador, así que Supabase aplica RLS a cada cambio.
  - Las 13 tablas publicadas tienen RLS de solo administrador.
  - El navegador nunca recibe datos que no pueda leer por RLS: además, relee con la sesión y no usa el contenido del aviso.
- **Documentos y fichas:** el administrador solo lee. Las escrituras las hace el motor (`service_role`) dentro de una ejecución con lease. El bucket `documents` es privado.
- **Claves:** el código del navegador no contiene la clave secreta de Supabase ni la de Anthropic (búsqueda en `.next/static`). La clave publicable se pasa en tiempo de ejecución y solo al administrador.
- **ToolGateway:** es la única vía de ejecución de herramientas. Solo se llama desde `loop.ts` (2 puntos); la oficina 3D y el Centro de mando no ejecutan nada.
  - Acciones de servidor que escriben: crear encargo, cancelar o reanudar misión, guardar límites (Configuración) y alta del administrador. Todas existían antes de esta fase.
  - La acción nueva `refreshOffice` solo lee.
- **Límites económicos y reservas:** sin cambios. 1 $ por misión, 1 $ por tarea, 10 $ al mes, 0,25 $ de reserva para Alex, 5 empresas y 15 búsquedas. El sobrecoste detiene la misión y las llamadas inciertas no se repiten. Reservas atómicas cubiertas por 34 pruebas.
- **Acciones externas:** no hay ninguna habilitada.
  - Herramientas del piloto: Alex lee memoria y CRM, redacta y delega. Marcus además escribe en el CRM y usa búsqueda y lectura web. Sofia lee memoria y CRM y redacta.
  - Email, n8n, publicación y contacto no están conectados al motor y se rechazan por permisos (con pruebas).

## 7. Rendimiento
- **Paquete 3D** (se descarga solo al abrir la vista 3D):

  | Compresión | Tamaño |
  |---|---|
  | Sin comprimir (minificado) | 932 KB |
  | gzip | 245–252 KB |
  | **Brotli** (lo que sirve Vercel) | **201 KB** |

- **Composición, medida con mapas de código fuente:** three.js 72 %, React Three Fiber (incluye su reconciliador de React) 24 %, drei 0,7 % y código propio 1,3 %.
- **Opciones estudiadas:**
  - webpack en vez de Turbopack: el mismo tamaño (249 KB gzip). No aporta.
  - three.js se distribuye como un único módulo y apenas permite eliminar código no usado.
  - Quitar React Three Fiber y escribir la escena con three.js puro ahorraría unos 50–60 KB. Supone reescribir la oficina y no lo hago sin decisión vuestra.
- **Decisión:** no se reduce de forma artificial. Se mantienen la carga diferida y la alternativa en lista. El tamaño real servido (201 KB con Brotli) está prácticamente en el objetivo.
- **Mediciones en el contenedor** (modo desarrollo, GPU por software): lienzo dibujado en unos 1,5 s, unos 29 fps al girar la cámara y 28 MB de memoria. **Todavía no se ha medido en un móvil físico.**

## 8. Riesgos residuales
1. Realtime con Supabase real no está probado todavía; se valida en producción (punto 11).
2. No medido en un móvil físico.
3. El control de coherencia (F) busca frases concretas: una negación redactada de otra forma podría no detectarse.
4. Los 3 avisos de seguridad de Supabase indicados en el punto 6 siguen como estaban.
5. El proyecto no tiene linter propio.
6. El código nuevo requiere la 0008: si se desplegara antes de la migración, las misiones fallarían al registrar entregas. El orden está fijado en los pasos 9 y 10.

## 9. Pasos exactos para aplicar la 0008 (cuando se autorice)
1. **Ventana sin actividad.** Ejecutar en solo lectura y comprobar que da `0, 0, 0`:
   ```sql
   select (select count(*) from public.agent_runs where status in ('running','queued')),
          (select count(*) from public.tasks where locked_by is not null),
          (select count(*) from public.ai_reservations where status in ('open','uncertain'));
   ```
   No crear encargos ni tener abierta ninguna página de encargo durante la aplicación.
2. **Estado previo:**
   - `list_migrations` termina en `20261030150351 · budget_reservations` (9 entradas).
   - `supabase/checks/schema-fingerprint-summary.sql` coincide con la tabla de abajo (columna «Antes»), salvo `fn`, que debe tener n = 36.
3. **Guardar los recuentos de datos** para compararlos al final (punto 3).
4. **Aplicar** con `apply_migration`, nombre `deliveries_facts_realtime` y el contenido íntegro de `0008_deliveries_facts_realtime.sql` (sha256 `bad13309…9cbb`). Se ejecuta en una transacción: si falla, no se aplica nada.
5. **Verificar:**
   - `list_migrations` tiene 10 entradas.
   - La huella coincide con la columna «Después» (en `fn` basta con n = 40, por los comentarios de las 6 funciones antiguas).
   - `settings.confidence_rules` existe.
   - Hay 13 tablas en `supabase_realtime`.
   - `get_advisors(security)` no muestra avisos nuevos.
   - Los recuentos de datos no han cambiado.
6. **Si algo falla:** el código publicado sigue funcionando con o sin la 0008. Informar y no tocar nada más. La marcha atrás solo se ejecuta con autorización.

| Categoría | Antes (n · h) | Después (n · h) |
|---|---|---|
| col | 309 · 34d5d0d9ae1c | 357 · 2197fe2bd056 |
| con | 108 · 7c16c0de4a11 | 126 · 57ed6d5a94cf |
| enum | 6 · ddd2d9aaedeb | 6 · ddd2d9aaedeb |
| fexec | 108 · 602d07f16e9b | 120 · 0de3e9ad5b1b |
| fn | 36 · (comentarios) | 40 · (comentarios) |
| grant | 50 · 3448cfb61bfa | 56 · 1be0b33dac38 |
| idx | 52 · b0dda439ac2e | 60 · d3e3ad79ff34 |
| pol | 25 · 6ee1f195b1ec | 27 · f64c5270022f |
| pub | 7 · 0203a0a1b63b | 13 · a9318ec7096d |
| rls | 25 · 314c5c5f95f7 | 28 · b3a5866c616f |
| setting | 3 · 4068f80674a7 | 4 · 50d4aa10fbbe |
| trg | 16 · a0435e6f5e7f | 17 · 7c0d2cc25e47 |
| view | 3 · 0abc8dbb1a41 | 4 · 8d1b493b2671 |

## 10. Pasos exactos para desplegar en Vercel (después de la 0008 y cuando se autorice)
1. **Variables de entorno:** no hay que cambiar ninguna. Realtime usa `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, que ya existen.
2. **Desplegar** con `create_deployment`:
   - proyecto `he-signal-office`, destino `production`;
   - `gitSource` de GitHub `ericarru94-lgtm/Oposiciones_app`, rama `ccr-30b91845-834xuv`, con el **sha del commit final**;
   - Root Directory `office`.
3. **Esperar `READY`** y revisar los eventos del build: sin errores y con las mismas rutas que en local.
4. **Prueba de humo con sesión real:**
   - `/` abre en 3D en el ordenador y en lista en el móvil;
   - `/centro` muestra los datos reales: el gasto del mes y las misiones anteriores;
   - `/tareas` muestra las misiones anteriores con su resultado;
   - las cabeceras de seguridad están presentes.
5. **Marcha atrás:** promover el despliegue anterior `dpl_H6p95gufhKbdFumqLFG4PJnzSgLt` (`01432bd`), que es compatible con la 0008 aplicada.

## 11. Comprobaciones para validar Realtime
1. Con sesión de administrador, el indicador de la oficina pasa a «En directo» en pocos segundos y la consola del navegador no muestra errores.
2. **RLS:** en una ventana privada sin sesión, `/` lleva a `/login` y no se abre ningún canal. Se puede comprobar en la pestaña Red del navegador o en los registros de Realtime de Supabase (`query_logs`, servicio realtime, solo lectura).
3. **Cambios en vivo, sin escribir nada a propósito:** durante la cuarta misión los estados de Alex, Marcus y Sofia cambian solos en la oficina, en 3D y en lista, sin recargar, y coinciden con los de `/tareas/[id]`.
4. **Reconexión:**
   - Cortar la red (modo avión o wifi): el indicador pasa a «Sin conexión».
   - Restaurarla: pasa a «En directo» y los datos se releen. Deben coincidir con los que se ven tras recargar la página.
   - Volver a la pestaña después de 1 minuto en segundo plano: se releen los datos.
5. **Limpieza:** al cambiar de página y volver, solo hay un canal abierto (un WebSocket con un único `phx_join` del canal `office`).

## 12. Plan de la cuarta misión (cuando se autorice)
- **Objetivo:** validar A–F de principio a fin con datos reales.
- **Límites:** sin cambios. 1 $ por misión, 5 empresas, 15 búsquedas y 0,25 $ de reserva para Alex. Coste esperado entre 0,30 y 0,60 $; tope duro de 1 $.
- **Encargo:**
  - la misión del piloto (estudio de gimnasios y boxes de Barcelona, todo en borrador y sin contactar a nadie);
  - con la casilla de **reutilizar las 5 fichas** marcada, para que Marcus complete lo pendiente (por ejemplo, BodyMind) y registre los datos con procedencia.
- **Durante la misión:** mantener abierta la página del encargo y la oficina en otra pestaña (punto 11).
- **Criterios de éxito:**
  - **A:** Marcus hace varias rondas mientras quedan objetivos y no se para por error tras la primera llamada.
  - **B:** Sofia empieza después de que Marcus termine o falle (dependencia `sofia → marcus` en `task_dependencies`).
  - **C:** hay filas en `task_deliveries` que pasan por preparada → recibida, y el informe de Alex incluye el INVENTARIO DE ENTREGAS.
  - **D:** cada subtarea tiene su `result_data.outcome`, y el Centro de mando muestra el resultado de la misión.
  - **E:** hay filas en `company_facts` con su fuente, confianza según la regla, `observed_at` de la base de datos y las contradicciones marcadas.
  - **F:** el informe final lleva el «Control automático de coherencia (sistema)», sin avisos o con avisos justificados.
  - **Costes:** ningún `cost_overrun`, ninguna llamada incierta repetida y ningún error 400.
- **Paradas:**
  - `cost_overrun`: la misión se detiene sola.
  - Error 400 o comportamiento inesperado: cancelar desde la página y avisar.
  - No hay reintentos manuales sin análisis.
- **Después:** informe con las capturas, el coste real por agente y las consultas de solo lectura de `task_deliveries`, `company_facts` y `result_data`.
