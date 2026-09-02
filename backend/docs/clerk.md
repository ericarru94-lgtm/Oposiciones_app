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
   busca por email de forma insensible a mayúsculas (`mode: "insensitive"`,
   sin necesitar la extensión `citext`): si ya había una fila con ese email
   (p.ej. de antes de migrar a Clerk, o de la instancia de Clerk
   Development antes de pasar a Production), la enlaza en vez de
   duplicarla; si no, crea una fila nueva con `esAdmin` ya calculado.

## Migrar la instancia de Clerk de Development a Production

Clerk trata Development y Production como dos poblaciones de usuarios
totalmente separadas: al pasar a producción, cada persona recibe un
`clerkUserId` **nuevo y distinto** al que tenía en development, aunque
inicie sesión con el mismo email. El paso 2 de arriba está pensado
precisamente para que esto no rompa nada: en el primer login contra la
instancia de producción, se busca la fila de `Usuario` existente por
email (insensible a mayúsculas) y se le actualiza el `clerkUserId`,
conservando intacto su `plan`, `stripeCustomerId` y todo lo demás.

Si aun así aparece un usuario con una fila duplicada en plan gratuito
(por ejemplo, porque inició sesión en producción antes de que este fix
insensible a mayúsculas estuviera desplegado, o porque el email que
Clerk tiene registrado no es exactamente el mismo string que el de la
fila antigua), hay un script de diagnóstico/reparación:

```
DATABASE_URL="<connection string de producción>" npm run fusionar-duplicado -- <email>
```

Sin `--aplicar` solo diagnostica (lista las filas encontradas, cuál
parece la "original" por tener `stripeCustomerId`, y si la duplicada
tiene progreso que se perdería). Con `--aplicar` traslada el
`clerkUserId` nuevo a la fila original y borra la duplicada — se niega a
hacerlo si la duplicada tiene datos, salvo que se añada también
`--forzar`. Ver la cabecera de
`backend/src/scripts/fusionar-usuario-duplicado.ts` para el detalle. El
plan free de Render no da Shell, así que esto se ejecuta desde tu propio
equipo apuntando al **External Database URL** de la Postgres de Render
(Dashboard → tu base de datos → Connect), nunca pegando esa URL en
ningún archivo que se commitee.

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
- `CLERK_SECRET_KEY`/`CLERK_PUBLISHABLE_KEY` deben quedar **vacías
  explícitamente** (`CLERK_SECRET_KEY=`, no omitirlas) — `@prisma/client`
  carga su propio `.env` al inicializarse y, si se omiten, las rellenaría
  solas con las reales de `backend/.env`, activando el `clerkMiddleware()`
  real en un entorno que no tiene red hacia Clerk. Ver el bug real
  documentado en `backend/docs/testing.md`.

Frontend (`frontend/.env`):
- `VITE_CLERK_PUBLISHABLE_KEY`: clave publicable de la misma instancia de
  Clerk. Sin ella, la app cae en el modo bypass (pensado solo para
  Playwright: no hay forma de iniciar sesión real desde la UI sin ella).

Frontend (`frontend/.env.e2e`, exclusivo de E2E):
- `VITE_E2E_AUTH_BYPASS_SECRET`: debe coincidir exactamente con
  `AUTH_TEST_BYPASS_SECRET` del backend de E2E.
- `VITE_CLERK_PUBLISHABLE_KEY` debe quedar **vacía explícitamente** por el
  mismo motivo que arriba, pero por la cascada de `.env`/`.env.[modo]` de
  Vite en vez de por Prisma — mismo efecto, mecanismo distinto.

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

## Configuración del Dashboard de Clerk: sin username

El formulario de `<SignUp/>` lo renderiza Clerk según la configuración de
su Dashboard (Configure → User & Authentication → Email, Phone, Username),
no según props que le pasemos aquí. Si "Username" está activado como
identificador (obligatorio u opcional), Clerk puede pedirlo en un paso
adicional tras verificar el email — una pantalla que esta app no controla
ni necesita: el nombre para mostrar ya lo cubre el que el usuario escriba
al completar el perfil o, por defecto, el propio email.

Para quitar ese paso: en el Dashboard de Clerk, Configure → User &
Authentication → Username → desactivarlo (o dejarlo como campo opcional
que Clerk no pida en el alta). Es un cambio de configuración externo al
código, no algo que se pueda arreglar editando `Auth.tsx`.

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

## Troubleshooting: frontend colgado en "Cargando…"

Si la web se queda indefinidamente en "Cargando…" en vez de mostrar la
landing o el panel, la causa casi siempre es que `ClerkProvider` nunca
resuelve (`isLoaded` de Clerk no llega a `true`) — `cargando` en
`SessionContext.tsx` depende de eso, y de `cargando` dependen `Inicio.tsx`,
`RutaProtegida.tsx` y `RutaAdmin.tsx` (las tres pantallas que muestran
`<PantallaCargando/>`, en `frontend/src/components/PantallaCargando.tsx` —
tras ~8s sin resolverse muestra un aviso con botón "Recargar" en vez de
dejar un spinner infinito, para que el síntoma sea detectable desde la UI
sin abrir DevTools).

Esto **no es un bug de este repo**: no hay código propio en el camino de
arranque de Clerk más allá de pasarle `publishableKey` en `main.tsx`, y no
hay ninguna cabecera CSP (ni en `vercel.json` ni en `index.html`) que
pudiera bloquear sus scripts. Cuando pasa, suele coincidir con un cambio
reciente en el Dashboard de Clerk o en las variables de entorno de Vercel.
Para diagnosticarlo, abre DevTools → Consola y Network en el dominio
afectado y mira qué falla en las peticiones hacia Clerk (su Frontend API,
normalmente algo como `clerk.<tu-dominio>` si tienes dominio personalizado,
o `<slug>.clerk.accounts.dev` si no):

- **Error de CORS / dominio no autorizado** ("blocked by CORS policy" o
  similar apuntando al Frontend API de Clerk): la instancia de Production
  de Clerk exige que cada dominio desde el que se sirve el frontend esté
  dado de alta explícitamente — a diferencia de Development, que es
  permisivo. Revisa Clerk Dashboard → **Domains** y confirma que están
  `aprobox.es` y, si sigue en uso, el dominio antiguo de Vercel.
- **Petición que nunca responde (queda "pending") o `DNS_PROBE_FINISHED_NXDOMAIN`**
  hacia un subdominio tipo `clerk.aprobox.es`: significa que la instancia
  de producción está configurada con un dominio personalizado para Clerk y
  el DNS (registros CNAME que pide Clerk Dashboard → Domains) todavía no
  ha propagado o no se ha completado. La app se queda colgada porque el
  SDK está esperando a un host que no resuelve.
- **"The publishableKey passed to Clerk is invalid" en consola** (suele
  venir con pantalla en blanco, no con el spinner colgado): `VITE_CLERK_PUBLISHABLE_KEY`
  en Vercel no es la clave de Production (debe empezar por `pk_live_`) o
  está vacía/mal copiada tras el último deploy.

Ninguna de estas tres causas se arregla tocando código de este repo — son
configuración de Clerk Dashboard (Domains) o de las variables de entorno
de Vercel. Cambiar las credenciales de un proveedor OAuth (p.ej. pasar
Google de las credenciales compartidas de Clerk a un Client ID/Secret
propio) no debería por sí solo causar esto, pero si coincidió con pasar la
instancia a Production o con activar un dominio personalizado para Clerk,
revisa esos dos puntos primero.
