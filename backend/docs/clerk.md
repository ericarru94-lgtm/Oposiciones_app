# Clerk: autenticación

El registro/login los gestionan directamente los componentes de Clerk en
el frontend (`<SignUp/>`/`<SignIn/>`); el backend nunca ve una contraseña.
Cada request autenticada trae un token de sesión de Clerk (`Authorization:
Bearer <token>`); el backend lo verifica y lo traduce a una fila de
`Usuario` propia vía `clerkUserId`.

## Piezas

| Pieza | Dónde |
|---|---|
| Middleware global (decora `req` si hay sesión) | `clerkMiddleware()` en `backend/src/app.ts` |
| Traducir Clerk → `Usuario` (find-or-create) | `backend/src/lib/clerkSync.ts` |
| `authOpcional`/`authRequerido`/`requiereAdmin` | `backend/src/middleware/auth.ts` |
| `ClerkProvider`, `<SignIn/>`/`<SignUp/>` | `frontend/src/main.tsx`, `frontend/src/pages/Auth.tsx` |
| Sesión de la app (token, perfil, sincronización) | `frontend/src/context/SessionContext.tsx` |
| Pantalla de perfil | `frontend/src/pages/Perfil.tsx` |

## El contrato interno no cambia: `req.auth.usuarioId`

Antes de Clerk, `middleware/auth.ts` firmaba y verificaba un JWT propio y
dejaba `req.auth = { usuarioId }`. Todas las rutas protegidas
(`admin.ts`, `progreso.ts`, `preguntas.ts`, `stripe.ts`) solo conocen ese
contrato — nunca a Clerk directamente. Al migrar, `authOpcional`/
`authRequerido` se reescribieron por dentro para resolver `usuarioId` a
partir de la sesión de Clerk, pero siguen dejando exactamente el mismo
`req.auth = { usuarioId }`, así que **ninguna otra ruta necesitó cambios**.

`getAuth(req)` (de `@clerk/express`) da el `userId` de Clerk (`user_xxx`);
`obtenerOCrearUsuarioDesdeClerk(clerkUserId)` en `lib/clerkSync.ts`:

1. Busca un `Usuario` con ese `clerkUserId`. Si existe, lo devuelve (y si
   su email acaba de entrar en `ADMIN_EMAILS`, activa `esAdmin` de paso —
   igual que hacía antes `sincronizarEsAdmin` en cada login).
2. Si no existe, pide el email a Clerk (`clerkClient.users.getUser`) y
   hace un `upsert` por email: si ya había una fila con ese email (p.ej.
   de antes de migrar a Clerk), la enlaza en vez de duplicarla; si no,
   crea una fila nueva con `esAdmin` ya calculado.

## Por qué `clerkMiddleware()` se monta condicionalmente

A diferencia del cliente de Stripe (que solo se toca dentro de las rutas
de `/stripe`), `clerkMiddleware()` es middleware **global**: corre en
cada petición, incluidas las públicas. Mirando el código instalado de
`@clerk/express` se confirmó que, aunque la fábrica `clerkMiddleware()`
nunca lanza al llamarla, el middleware que devuelve sí lanza en tiempo de
petición si no hay `CLERK_SECRET_KEY`/`CLERK_PUBLISHABLE_KEY` — lo que
tumbaría con un 500 **cualquier** request (hasta las anónimas) en un
entorno sin esas claves configuradas.

Por eso `app.ts` decide en el arranque:

```ts
const clerkConfigurado = Boolean(process.env.CLERK_SECRET_KEY && process.env.CLERK_PUBLISHABLE_KEY);
app.use(clerkConfigurado ? clerkMiddleware() : (_req, _res, next) => next());
```

Sin claves (como en los entornos de test), se monta un simple
paso-a-través: las peticiones llegan como anónimas a `authOpcional`/
`authRequerido`, que ya saben tratarlas (401 en las que lo requieren, sin
romper nada en las que no).

## Por qué existen dos formas de "estar autenticado" en el frontend

Este proyecto se desarrolla en un entorno con la salida de red bloqueada
hacia `clerk.com`/`api.clerk.com` (la misma política que bloquea
`api.stripe.com`, ver `backend/docs/testing.md`), y además la CLI de
Clerk (`clerk auth login`) usa un flujo OAuth con un callback en un puerto
local que, en un contenedor remoto, el navegador real del usuario no
puede alcanzar aunque la red no estuviera bloqueada. Ninguna de las dos
cosas es específica de este proyecto, pero juntas significan que **Clerk
real nunca puede probarse de punta a punta dentro de este entorno**, ni en
desarrollo ni en los tests E2E (Playwright).

Por eso `frontend/src/context/SessionContext.tsx` tiene dos
implementaciones de `SessionProvider`, elegidas una sola vez al cargar el
módulo según si `VITE_CLERK_PUBLISHABLE_KEY` está definida:

- **Con la clave** (desarrollo/producción reales): `SessionProviderClerk`,
  que usa `useAuth()`/`useUser()` de `@clerk/clerk-react` de verdad.
- **Sin la clave** (solo en el modo E2E de Playwright, ver
  `frontend/.env.e2e`): `SessionProviderBypass`, que no monta
  `<ClerkProvider>` en absoluto (intentaría cargar el script de Clerk
  igualmente y fallaría) y en su lugar lee un token de la forma
  `e2e-bypass:<secreto>:<usuarioId>` de `localStorage`, que Playwright
  inyecta (`frontend/e2e/helpers.ts`) tras crear el usuario vía
  `POST /auth/registro-bypass`.

El backend refleja el mismo bypass en `middleware/auth.ts`
(`extraerUsuarioIdDeBypassE2E`): si `AUTH_TEST_BYPASS_SECRET` está
definido y el header trae `Bearer e2e-bypass:<secreto>:<usuarioId>` con el
secreto correcto, confía en ese `usuarioId` sin pasar por Clerk. Esta
variable **solo existe en `backend/.env.e2e`**; en cualquier otro entorno
(dev, test unitarios, producción) el bypass es inalcanzable porque la
variable no está definida — el guard es `if (!secreto) return null`, no
una lista de exclusión que alguien pueda olvidar mantener.

`POST /auth/registro-bypass` (el endpoint que crea/reutiliza el `Usuario`
para el bypass) tiene el mismo guard: sin `AUTH_TEST_BYPASS_SECRET`
configurado responde 404, como si no existiera.

Ninguna de las dos variables (`AUTH_TEST_BYPASS_SECRET` en el backend,
`VITE_E2E_AUTH_BYPASS_SECRET` en el frontend) debe definirse jamás fuera
de `.env.e2e` — hacerlo en producción abriría una puerta de autenticación
sin verificar.

## Variables de entorno

Backend (`backend/.env`):
- `CLERK_SECRET_KEY` / `CLERK_PUBLISHABLE_KEY`: claves de tu instancia de
  Clerk (dashboard.clerk.com). Sin ellas el backend arranca (ver arriba)
  pero nadie puede autenticarse de verdad.

Backend (`backend/.env.e2e`, exclusivo de E2E):
- `AUTH_TEST_BYPASS_SECRET`: habilita el bypass de autenticación de arriba.

Frontend (`frontend/.env`):
- `VITE_CLERK_PUBLISHABLE_KEY`: clave publicable de la misma instancia de
  Clerk. Sin ella, la app cae en el modo bypass (pensado solo para
  Playwright: no hay forma de iniciar sesión real desde la UI sin ella).

Frontend (`frontend/.env.e2e`, exclusivo de E2E):
- `VITE_E2E_AUTH_BYPASS_SECRET`: debe coincidir exactamente con
  `AUTH_TEST_BYPASS_SECRET` del backend de E2E.

## Adoptar el progreso del onboarding tras el alta

El onboarding (mini-test + primer test) se responde como visitante
anónimo, con un `sesionAnonima` (UUID) en `localStorage`. Antes, el
propio endpoint `/auth/registro` reclamaba esos intentos de forma
síncrona como parte de la respuesta. Como ahora el alta la gestiona Clerk
directamente (el backend no interviene en ese paso), se reclama con una
llamada aparte: `POST /auth/reclamar-sesion-anonima { sesionAnonima }`
(requiere sesión), que reutiliza `reclamarIntentosAnonimos` — ya era
idempotente (no encuentra nada la segunda vez que se llama con la misma
`sesionAnonima`), así que no hay problema en llamarla más de una vez.

También hay que guardar el `nivelInicial` elegido en el onboarding, que
antes viajaba dentro del body de `/auth/registro`: ahora
`PATCH /auth/me/onboarding { nivelInicial }` se llama por separado.

Ambas llamadas las dispara `SessionContext` en cuanto detecta
`estaAutenticado = true` (ver `useSincronizarTrasLogin`). En el modo
bypass, además, se hacen **antes** de navegar a `/home` (dentro de
`iniciarSesionBypass`), para que Home ya vea el progreso reclamado en su
primera carga en vez de depender de un efecto asíncrono que podría
resolverse después del primer fetch de Home — importante para que el test
E2E de onboarding sea determinista. En el modo Clerk real esta llamada
queda en manos de un efecto tras el redirect de `<SignUp/>`, con una
pequeña ventana de inconsistencia eventual (el progreso puede tardar un
instante en aparecer) que no afecta a ningún test de este repo.

## Volver a una pantalla concreta tras autenticarse (`destino`)

`Login`/`Registro` leen un parámetro `?destino=` de la URL y se lo pasan a
`Auth` como `fallbackRedirectUrl` de `<SignIn/>`/`<SignUp/>` (o, en modo
bypass, como la URL a la que navega `iniciarSesionBypass` al terminar).
También se propaga al enlace "¿Ya tienes cuenta?"/"Crear cuenta" que el
propio componente de Clerk ofrece para cambiar de login a registro (o
viceversa), así que ese cambio no pierde a dónde había que volver.

El caso de uso real es `/upgrade`: al pulsar "Suscribirme" sin sesión,
`Upgrade.tsx` navega a `/registro?destino=%2Fupgrade%3Fcontinuar%3D1` en
vez de a un placeholder. Al completar el alta, Clerk redirige de vuelta a
`/upgrade?continuar=1`; `Upgrade` detecta ese parámetro y dispara el
checkout automáticamente en cuanto `estaAutenticado` es true, sin que el
usuario tenga que pulsar el botón una segunda vez. Detalle completo del
lado de Stripe en `backend/docs/stripe.md`.

## Perfil

`frontend/src/pages/Perfil.tsx` combina `perfilExterno` (nombre, email,
foto — de Clerk en modo real; solo el email en modo bypass) con datos
propios vía `GET /auth/me` y `GET /progreso/resumen` (plan, preguntas
respondidas, % de acierto, racha).

## Tests

`backend/src/routes/__tests__/clerk-auth.test.ts` (6 tests) y el resto de
la suite de integración mockean `@clerk/express` por completo
(`backend/src/test-utils/clerkMock.ts`, mismo patrón `vi.hoisted` +
`vi.mock` que ya se usaba para Stripe): el header `Authorization: Bearer
<valor>` se trata directamente como el `clerkUserId`, así que los tests
fabrican identidades con cualquier string y las registran con
`mockUsuarioClerk(clerkUserId, email)` antes de usarlas — nunca se llama
a la API real de Clerk. Cubre: 401 sin sesión, alta perezosa de `Usuario`
en el primer login y reutilización después, vínculo por email de una fila
preexistente, reclamo de intentos anónimos, y el bypass de E2E (activo y
también su ausencia de "magia" cuando `AUTH_TEST_BYPASS_SECRET` no está
definido).

Los tests de componentes de frontend (`TestRunner.test.tsx`,
`FormularioPreguntaAdmin.test.tsx`, `Upgrade.test.tsx`) mockean
`useSession()` directamente (como ya hacían), así que no les afecta si por
debajo hay Clerk real o el modo bypass. `Upgrade.test.tsx` cubre además el
redirect a `/registro`/`/login` cuando no hay sesión y el auto-continuar
el checkout al volver con `?continuar=1`. La suite E2E completa corre en
modo bypass (ver arriba) y cubre el alta al final del onboarding, un spec
dedicado (`e2e/perfil.spec.ts`) para la pantalla de perfil, y otro
(`e2e/upgrade-auth.spec.ts`) para "Suscribirme sin sesión -> registro ->
vuelta a /upgrade -> checkout automático".

No hay (ni puede haber, en este entorno) un test E2E que ejercite Clerk de
verdad — la misma limitación de red que impide probar el Checkout real de
Stripe punta a punta (ver `backend/docs/stripe.md`).
