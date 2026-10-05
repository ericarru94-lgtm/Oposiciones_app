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

### 4.1 — Riesgo de correctness: `DELETE /api/auth/cuenta` puede fallar si el usuario tiene `PushSuscripcion`

**No corregido en este pase** (cambiaría comportamiento observable: una
petición que hoy podría fallar pasaría a tener éxito).

`routes/auth.ts`, el flujo de borrado de cuenta, borra
`Progreso`/`Intento`/`SesionTest` y `Usuario` en una transacción, pero
`PushSuscripcion.usuarioId` no tiene `onDelete: Cascade` ni se borra
explícitamente ahí. Si el usuario activó alguna vez las notificaciones
push, el `DELETE` del `Usuario` violaría la foreign key y la transacción
fallaría entera — el usuario no podría borrar su cuenta, justo en el
flujo que (por RGPD) más debe funcionar siempre.

**Recomendación**: añadir `prisma.pushSuscripcion.deleteMany({ where: { usuarioId } })`
dentro de la misma transacción en `routes/auth.ts`. Cambio de una línea,
pero es una corrección de comportamiento real, así que se deja para que
se apruebe explícitamente antes de tocarlo.

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

Todo esto quedó consolidado en un único punto cada uno (ver sección 6,
"qué se tocó"). Nota: parte de este trabajo (el upsert SM-2 y el N+1 de
`/progreso/por-tema`) se solapó con un refactor hecho en paralelo por
otra sesión sobre esta misma rama — se fusionó sin perder ninguna de las
dos aportaciones (ver el commit de merge).

### 4.3 — Escalabilidad: `GET /progreso/comunidad`

**No corregido en este pase** (requeriría mover la agregación a SQL, con
riesgo de desviarse del resultado exacto sin poder validarlo contra datos
reales de producción).

`progreso.ts` trae **todos** los intentos de **todos los demás
usuarios** (`prisma.intento.findMany({ where: { usuarioId: { not: usuarioId } } })`,
sin `take`) para calcular la media de racha/precisión de la comunidad en
JavaScript. Hoy es barato (poco tráfico, pocos usuarios). Con más
`Intento` acumulados, este es el primer endpoint que se volverá caro —
crece linealmente con el historial de TODA la base de usuarios, no con
nada que el usuario controle.

**Recomendación cuando haga falta**: mover el cálculo de
total/aciertos/racha a una agregación SQL (`GROUP BY usuarioId`) o, más
simple, cachear la media de la comunidad (recalculada cada pocas horas
por un cron, no en cada petición) ya que no necesita ser exacta al
segundo — es "motivación", no un dato crítico.

También falta un índice en `Intento.preguntaId` solo: `routes/progreso.ts`
(`/por-tema`, ya optimizado) y `routes/favoritos.ts` filtran por la
relación `pregunta.temaId`, apoyándose en el índice de `Pregunta`, no en
uno de `Intento` — no es urgente hoy, pero merece revisarse si `Intento`
crece mucho y esas consultas se notan en los logs de Postgres.

### 4.4 — Duplicación de UI no resuelta: botón primario y `TestRunner` vs `SimulacroRunner`

**No corregido en este pase** (requiere verificación visual en navegador
con estados `disabled`/`loading` reales, que no pude hacer de forma
fiable sin backend autenticado accesible desde este entorno).

- El estilo de botón primario grande (`rounded-xl bg-primary px-4 py-3...`)
  está repetido en 4 archivos / 8 sitios (`TestRunner.tsx`,
  `SimulacroRunner.tsx`, `Simulacro.tsx`, `ExamenOficial.tsx`), mezclado
  con `<button>` y `<Link>`, algunos con `disabled`/`w-full`. Extraerlo
  pide un componente polimórfico (`as="button" | "link"`) — más superficie
  de riesgo que el `<Card>` ya extraído (sección 6).
- `TestRunner.tsx` (360 líneas) y `SimulacroRunner.tsx` (180 líneas)
  comparten la etiqueta de opciones (a/b/c/d), el manejo de `ApiError`/429
  al responder, y la estructura de la barra de progreso — pero divergen
  en lo importante (feedback inmediato + favoritos en uno, temporizador +
  feedback diferido en el otro). Fusionarlos de verdad es un rediseño,
  no un refactor mecánico; no se ha intentado aquí.

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

1. **`DELETE /auth/cuenta`** (4.1): es una corrección de comportamiento,
   no una mejora de calidad — se deja fuera a propósito del "no cambies
   la funcionalidad" y se documenta como acción recomendada.
2. **`/progreso/comunidad`** (4.3): la optimización correcta implica SQL
   agregado que no pude validar bit a bit contra datos reales desde este
   entorno.
3. **Botón primario / fusión TestRunner-SimulacroRunner** (4.4): riesgo
   visual que exige QA en navegador con sesión autenticada real.
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
después del cambio.

**Frontend**: `hooks/useApiData.ts` (patrón fetch-al-montar compartido,
aplicado a Home/Progreso/Perfil/Temario), `lib/medallaSegunPorcentaje.ts`
(icono+mensaje por % de acierto), `components/Card.tsx` (contenedor
"tarjeta blanca", aplicado a 11 de 12 sitios).

**Verificación en cada paso**: `tsc --noEmit` limpio, suite completa de
tests (119 backend / 100 frontend), `oxlint` sin errores, `vite build`
sin warnings nuevos, y capturas de pantalla de landing/blog para
confirmar que el `<Card>` no cambió nada visualmente. Cero cambios de
comportamiento observable desde el frontend o la API pública.
