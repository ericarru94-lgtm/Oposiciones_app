# Arquitectura de Aprobox — auditoría e ingeniería inversa

Documento escrito como si un ingeniero sénior entrara por primera vez a
este código: reconstruye la arquitectura real (no la que el README
describe, que está parcialmente desactualizada), señala las zonas
críticas con evidencia concreta, y documenta qué se refactorizó en este
pase (sin tocar comportamiento, verificado con la suite de tests en cada
paso) y qué se deja documentado para una próxima vez porque el riesgo de
tocarlo a ciegas superaba el beneficio.

Última actualización: 2026-10-05.

## 1. Vista de conjunto

```
┌─────────────────┐       HTTPS        ┌──────────────────────┐
│  Frontend (SPA)  │ ─────────────────▶ │  Backend (Express)    │
│  React 19 + Vite │ ◀───────────────── │  Node + TypeScript    │
│  Vercel (estático)│      JSON          │  Render                │
└─────────────────┘                     └───────────┬───────────┘
        │                                            │
        │ @clerk/clerk-react                         │ Prisma Client
        ▼                                            ▼
┌─────────────────┐                     ┌──────────────────────┐
│  Clerk (auth)    │                     │  PostgreSQL            │
└─────────────────┘                     └──────────────────────┘
                                                      │
                          ┌───────────────────────────┼───────────────────────────┐
                          ▼                           ▼                           ▼
                   ┌─────────────┐           ┌─────────────┐             ┌─────────────┐
                   │   Stripe     │           │   Resend     │             │  web-push    │
                   │ (suscripción)│           │   (email)    │             │ (notific.)   │
                   └─────────────┘           └─────────────┘             └─────────────┘
```

No hay SSR ni capa de BFF: el frontend es una SPA estática (Vite build
servido por Vercel, con rewrite a `index.html` para las rutas de React
Router) que habla directamente con la API REST del backend vía `fetch`.
El backend es un monolito Express con Prisma como único acceso a datos.
Sin colas, sin caché (ni en memoria ni Redis), sin CDN de API. Para el
tamaño actual del dataset (~1.350 preguntas, tráfico bajo) esto es
correcto — no es deuda técnica, es la elección adecuada para la escala
real. Las zonas de riesgo de escalabilidad están localizadas (sección 4),
no son un problema de la arquitectura general.

## 2. Flujo de datos de punta a punta (ejemplo: responder una pregunta)

1. `TestRunner.tsx` (frontend) llama a `responderPregunta()` en
   `api/endpoints.ts`, que pasa por el único wrapper de fetch del
   frontend, `apiFetch()` en `api/client.ts` (añade `Authorization`,
   parsea JSON, lanza `ApiError` en fallos).
2. `POST /api/preguntas/:id/responder` — middleware: `authOpcional`
   (resuelve `req.auth.usuarioId` si hay sesión, nunca bloquea) →
   `limitarRespuestasAnonimas` (rate limit solo si no hay `req.auth`).
3. El handler (`routes/preguntas.ts`) valida con Zod, carga la
   `Pregunta`, crea un `Intento`, y si hay usuario autenticado llama a
   `registrarProgresoSM2()` (`lib/progresoSM2.ts`), el único punto que
   calcula el siguiente estado SM-2 y hace el upsert de `Progreso`.
4. Responde con `esCorrecta`/`explicacion`/`fuente` — nunca la
   `respuestaCorrecta` cruda salvo en este único endpoint, después de
   responder.
5. El frontend actualiza su estado local (favoritos, feedback visual) sin
   volver a pedir nada al backend hasta la siguiente pregunta.

Este mismo patrón (validar con Zod → cargar entidad → mutar → responder
DTO explícito, nunca el modelo de Prisma crudo) se repite en casi todos
los endpoints — es consistente en todo el backend, mérito real del
código existente.

## 3. Modelo de datos (Prisma / PostgreSQL)

- `Tema` (28 filas fijas: 16 Bloque I + 12 Bloque II) — `@@unique([bloque, numero])`.
- `Pregunta` (~1.350 filas) — `estado` (borrador/verificada/anulada) controla qué se sirve;
  `@@index([tipo, estado])`, `@@index([temaId])`.
- `Usuario` — vinculado a Clerk vía `clerkUserId` (único), a Stripe vía
  `stripeCustomerId`/`stripeSubscriptionId` (únicos). `plan` (free/premium) es la
  fuente de verdad de acceso, sincronizada solo desde `lib/sincronizarSuscripcion.ts`.
- `Progreso` — una fila por `(usuarioId, preguntaId)`, estado SM-2.
  `@@index([usuarioId, proximaRevision])` (soporta "Repasar hoy").
- `Intento` — log de cada respuesta, incluidas las anónimas
  (`usuarioId` nullable, `sesionAnonima`). `@@index([usuarioId, createdAt])`,
  `@@index([sesionAnonima, createdAt])`. **Sin índice en `preguntaId` solo**
  (ver sección 4.3).
- `PreguntaFavorita`, `PushSuscripcion`, `SesionTest`, `NewsletterSuscriptor` —
  tablas de apoyo, bien indexadas para su patrón de acceso.

Ningún modelo tiene `onDelete: Cascade` desde `Usuario` salvo
`PreguntaFavorita` — por diseño: `DELETE /auth/cuenta` borra
`Progreso`/`Intento`/`SesionTest` explícitamente en una transacción antes
de borrar `Usuario` (ver sección 4.1, un caso que esa transacción **no**
cubre).

## 4. Zonas críticas

### 4.1 — Falsa alarma descartada: `DELETE /api/auth/cuenta` y `PushSuscripcion`

La primera versión de este documento afirmaba que el borrado de cuenta
podía fallar por una foreign key si el usuario tenía una fila en
`PushSuscripcion`, basándose en una lectura del esquema que resultó
incompleta. Al verificarlo contra la migración real
(`20260831093411_push_suscripcion/migration.sql`) y con un test de
integración nuevo (`eliminar-cuenta.test.ts`, caso "borra la cuenta
igualmente si el usuario tiene una suscripción push activa"), queda
confirmado que **no hay bug**: `PushSuscripcion.usuarioId` sí tiene
`ON DELETE CASCADE` a nivel de base de datos, así que borrar el `Usuario`
borra en cascada su `PushSuscripcion` automáticamente. Se deja esta
nota en vez de borrar la sección sin más, para que quede constancia de
que el hallazgo original era incorrecto y por qué.

### 4.2 — Duplicación de lógica (corregido en este pase)

Antes del refactor:

| Lógica | Copias | Archivos |
|---|---|---|
| Fisher-Yates shuffle | 4 | `routes/preguntas.ts`, `lib/seleccionProporcional.ts`, `lib/examenOficial.ts`, `scripts/aleatorizar-respuestas.ts` |
| Envío de email con try/catch resiliente | 3 | `routes/newsletter.ts`, 2 funciones en `lib/notificacionesAdmin.ts` |
| Upsert de `Progreso` vía SM-2 | 3 | `POST /responder`, `POST /revisar`, `lib/reclamarIntentosAnonimos.ts` |
| Fallback de `FRONTEND_URL` | 2 | `routes/newsletter.ts`, `routes/stripe.ts` |
| `select` de campos públicos de Pregunta | 3 | `/aleatorias`, `/simulacro`, `/examen-oficial` en `routes/preguntas.ts` |
| Comprobación "¿es premium?" | repetida inline | `/aleatorias`, `/simulacro` |
| Patrón `useState`+`useEffect`+fetch-al-montar | 5 páginas | `Home.tsx`, `Progreso.tsx`, `Perfil.tsx`, `Temario.tsx` (`ResumenTema.tsx` excluido a propósito, ver 5.3) |
| Icono+mensaje según % de acierto | 3 | `TestRunner.tsx`, `Simulacro.tsx`, `ExamenOficial.tsx` |
| Estilo de tarjeta blanca (`rounded-2xl border border-line bg-card p-6`) | 11 (de 12; 1 descartado) | 8 páginas/componentes |
| Botón primario de ancho completo (`rounded-xl bg-primary px-4 py-3...`) | 10 | `TestRunner.tsx`, `SimulacroRunner.tsx`, `Simulacro.tsx`, `ExamenOficial.tsx`, `Auth.tsx`, `Upgrade.tsx` |

Todo esto quedó consolidado en un único punto cada uno (ver sección 6,
"qué se tocó"). Nota: parte de este trabajo (el upsert SM-2 y el N+1 de
`/progreso/por-tema`) se solapó con un refactor hecho en paralelo por
otra sesión sobre esta misma rama — se fusionó sin perder ninguna de las
dos aportaciones (ver el commit de merge).

### 4.3 — Escalabilidad: `GET /progreso/comunidad` (parcialmente corregido)

`progreso.ts` traía **todos** los intentos de **todos los demás
usuarios** (`prisma.intento.findMany({ where: { usuarioId: { not: usuarioId } } })`,
sin `take`) para calcular total, aciertos y racha de la comunidad en
JavaScript. Corregido en parte: el total y los aciertos por usuario ahora
se calculan con dos `prisma.intento.groupBy()` (agregados en la base de
datos, una fila por usuario distinto en vez de una fila por intento) en
lugar de sumarlos a mano sobre cada fila. Verificado sin cambiar el
resultado: los 4 tests de `progreso-comunidad.test.ts` (incluidos los que
comprueban la media exacta con `toBeCloseTo`) siguen pasando tal cual.

**Lo que queda sin resolver, a propósito**: la racha (días consecutivos
con actividad) sigue necesitando, para cada usuario, el conjunto de días
distintos en los que tuvo algún intento — y eso exige traer
`{usuarioId, createdAt}` de cada intento, uno a uno, porque Prisma no
permite agrupar truncando una fecha a "día" sin SQL crudo
(`DATE(createdAt)`). Ese camino existe (y en este entorno, con
`Intento.createdAt` como `timestamp without time zone` y tanto Node como
Postgres en UTC, sería seguro), pero no lo apliqué: no pude confirmar que
la base de datos de producción en Render también está en UTC, y una
discrepancia ahí correría el riesgo real de desplazar la racha de algún
usuario un día en el borde de la medianoche. Queda documentado para quien
lo aborde con esa confirmación hecha, o cachee la media en vez de
recalcularla en cada petición (no necesita ser exacta al segundo, es
"motivación", no un dato crítico).

También falta un índice en `Intento.preguntaId` solo: `routes/progreso.ts`
(`/por-tema`, ya optimizado) y `routes/favoritos.ts` filtran por la
relación `pregunta.temaId`, apoyándose en el índice de `Pregunta`, no en
uno de `Intento` — no es urgente hoy, pero merece revisarse si `Intento`
crece mucho y esas consultas se notan en los logs de Postgres.

### 4.4 — Botón primario duplicado (corregido) y fusión `TestRunner`/`SimulacroRunner` (no intentada)

El estilo de botón primario de ancho completo (`rounded-xl bg-primary
px-4 py-3... hover:bg-primary-hover`) estaba repetido en 10 sitios de 7
archivos, todos `<button>` (no `<Link>`, como se pensó en la primera
pasada de este documento) — se extrajo a `components/PrimaryButton.tsx`.
Verificado con la suite de tests unitarios, y sobre todo con la suite
E2E de Playwright (`frontend/e2e/`, que ya existía en el repo y no se
había ejecutado hasta ahora: requiere `backend/.env.e2e` y
`frontend/.env.e2e`, ninguno de los dos presente en el checkout — ver
sección 7): las 12 pruebas, que hacen login real vía el bypass de test y
clican estos botones exactos en el navegador (`TestRunner`,
`SimulacroRunner`, `Simulacro`, `ExamenOficial`, `Auth`, `Upgrade`),
siguen pasando igual tras el cambio.

Lo que sigue sin tocar: `TestRunner.tsx` (360 líneas) y
`SimulacroRunner.tsx` (180 líneas) comparten la etiqueta de opciones
(a/b/c/d), el manejo de `ApiError`/429 al responder, y la estructura de
la barra de progreso — pero divergen en lo importante (feedback
inmediato + favoritos en uno, temporizador + feedback diferido en el
otro). Fusionarlos de verdad es un rediseño, no un refactor mecánico de
los que cubre este documento.

### 4.5 — Componentes/páginas que mezclan responsabilidades

No se han dividido en este pase (dividir un componente de 300 líneas sin
poder probarlo visualmente es más probable que rompa algo que lo arregle).
Documentado para quien lo aborde con tiempo de QA en navegador:

- **`TestRunner.tsx`**: sub-componente de tabla de datos, cálculo de
  medalla, fetch de favoritos, lógica de respuesta con rollback optimista
  del favorito, y 3 ramas de render — todo en un archivo.
- **`Perfil.tsx`**: fetch de logros, lógica de insignias, redirección al
  portal de Stripe, y un flujo completo de borrado de cuenta con su
  propia máquina de estados de confirmación — 5 responsabilidades.
- **`Simulacro.tsx`**: máquina de estados de 4 fases + lógica de
  bloqueo premium + fetch + un componente de resultados con su propia
  agregación por bloque, todo en el mismo archivo.

## 5. Decisiones de alcance explícitas (qué no se tocó, y por qué)

1. **Racha de `/progreso/comunidad`** (4.3): el camino seguro (SQL con
   fecha truncada) no se aplicó por no poder confirmar que la Postgres de
   producción también está en UTC — ver 4.3 para el razonamiento
   completo. El total/aciertos sí se optimizó.
2. **Fusión `TestRunner`/`SimulacroRunner`** (4.4): es un rediseño, no
   una deduplicación mecánica — fuera de alcance de este pase.
3. **División de componentes que mezclan responsabilidades** (4.5): no
   están rotos, solo no están idealmente factorizados — dividirlos es
   una decisión de diseño que merece su propia conversación, no algo
   para decidir unilateralmente en una pasada de "arregla lo que
   encuentres".
4. **`ResumenTema.tsx`** se dejó fuera del hook `useApiData` a propósito:
   su `temaId` puede cambiar con el componente ya montado (navegar de un
   tema a otro sin desmontar), y mantiene a propósito el contenido
   anterior en pantalla mientras llega el nuevo en vez de mostrar
   "Cargando…" de golpe. El hook genérico sí resetea a "cargando" en cada
   cambio de dependencias — un comportamiento distinto que no quise forzar
   sin poder verlo en el navegador.

## 6. Qué se hizo en este pase (resumen, ver commits para el detalle)

**Backend** (`backend/src/lib/`, nuevos): `barajar.ts`,
`enviarEmailResiliente.ts`, `frontendUrl.ts`, `progresoPorTema.ts`,
`progresoSM2.ts`, mas `usuarios.ts` (`esUsuarioPremium`, incorporado de
un refactor en paralelo) — cada uno con un único punto de verdad que
antes estaba copiado 2-4 veces. `/progreso/por-tema` pasó de 2×N
consultas (N = nº de temas) a 3 consultas totales, con un test nuevo
(`progreso-por-tema.test.ts`) que fija el comportamiento exacto antes y
después del cambio. `/progreso/comunidad` dejó de sumar total/aciertos a
mano sobre cada intento y usa `groupBy` en su lugar. Se añadió un test
que confirma que `DELETE /auth/cuenta` no falla con `PushSuscripcion`
(la falsa alarma de 4.1).

**Frontend**: `hooks/useApiData.ts` (patrón fetch-al-montar compartido,
aplicado a Home/Progreso/Perfil/Temario), `lib/medallaSegunPorcentaje.ts`
(icono+mensaje por % de acierto), `components/Card.tsx` (contenedor
"tarjeta blanca", 11 sitios), `components/PrimaryButton.tsx` (botón
primario de ancho completo, 10 sitios).

**Verificación en cada paso**: `tsc --noEmit` limpio, suite completa de
tests (120 backend / 100 frontend), `oxlint` sin errores, `vite build`
sin warnings nuevos, capturas de pantalla de landing/blog, y — para los
cambios que tocaban componentes autenticados (`PrimaryButton`) — la
suite E2E de Playwright completa (12/12), con login real vía bypass de
test y clics reales sobre los componentes cambiados. Cero cambios de
comportamiento observable desde el frontend o la API pública.

## 7. Nota sobre el entorno de desarrollo local

Varios archivos de entorno necesarios para ejecutar la suite completa no
estaban presentes en el checkout (son locales/gitignored, como es
correcto): `backend/.env`, `backend/.env.test`, `backend/.env.e2e` y
`frontend/.env.e2e`, además de las claves VAPID de prueba en
`.env.test`. Se crearon a partir de sus `.example` para esta auditoría —
cualquiera que clone el repo por primera vez necesita este mismo paso
(ver los `README.md`/`backend/docs/testing.md` correspondientes).
