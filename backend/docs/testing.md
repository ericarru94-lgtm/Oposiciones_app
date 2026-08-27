# Estrategia de tests

Tres niveles, cada uno con su propio entorno aislado — ninguno toca nunca
la base de datos de desarrollo/producción (`oposiciones`):

| Nivel | Herramienta | Entorno | Qué cubre |
|---|---|---|---|
| Backend unit/integración | Vitest + Supertest | `oposiciones_test` (`backend/.env.test`) | Rutas HTTP contra una BD real, con fixtures propias por test |
| Frontend componentes | Vitest + Testing Library | ninguno (API mockeada) | Componentes React en aislado, sin red ni BD |
| E2E | Playwright | `oposiciones_e2e` (`backend/.env.e2e`), backend en :3002, frontend en :5174 | Flujos completos de usuario en un navegador real |

## Backend (`backend/src/routes/__tests__/*.test.ts`)

Ver [`estados-preguntas.md`](./estados-preguntas.md#tests) para el detalle
de esa suite. Resumen de comandos:

```bash
cd backend
cp .env.test.example .env.test
npm test
```

## Frontend: componentes (`frontend/src/**/*.test.tsx`)

```bash
cd frontend
npm test
```

Mockean `../api/endpoints` y `../context/SessionContext` con `vi.mock`, así
que corren sin backend ni base de datos. Cubren:

- **`TestRunner`**: seleccionar una opción llama a `responderPregunta` con
  los parámetros correctos, el feedback (correcto/incorrecto + explicación
  + fuente, o el aviso de que faltan) se muestra bien, el resumen final
  acumula aciertos/fallos a lo largo de varias preguntas, un 429 dispara
  `onLimiteAlcanzado` sin mostrar feedback, y el estado vacío (sin
  preguntas) no rompe nada.
- **`FormularioPreguntaAdmin`**: el botón "Verificar" se deshabilita sin
  respuesta correcta, editar y verificar manda los cambios exactos al
  backend, "Anular" pide `confirm()` antes de llamar, un error del backend
  se muestra y no avanza, y "Saltar" no llama a la API.

## E2E (`frontend/e2e/*.spec.ts`)

```bash
cd frontend
cp .env.e2e.example .env.e2e            # solo la URL del backend de E2E
cp ../backend/.env.e2e.example ../backend/.env.e2e
npm run test:e2e
```

`playwright.config.ts` levanta **su propio** backend (puerto **3002**,
`oposiciones_e2e`) y frontend (puerto **5174**, `vite --mode e2e`) — nunca
los de `npm run dev` (3001/5173), justamente para que un desarrollador con
la app abierta en otra pestaña no vea sus datos alterados ni, al revés,
que un servidor de desarrollo ya abierto en esos puertos se cuele en el
test por error. Antes de arrancar el backend, `npm run e2e:reset` (dentro
de `backend/package.json`) migra y **resetea por completo** la base de
datos de E2E con un seed determinista
(`backend/src/scripts/seed-e2e.ts`) — se borra todo lo que hubiera y se
recrean 3 temas, cada uno reservado a un spec para que no se pisen entre
sí (el orden de ejecución de los ficheros no está garantizado):

| Tema (seed) | Usado por | Por qué así |
|---|---|---|
| "La Constitución Española de 1978" (6 preguntas, todas con respuesta "a") | `onboarding.spec` (primer test) y `daily-limit.spec` (drenado del límite) | Respuesta única conocida → el primer test del onboarding es 100% determinista |
| "Tema de prueba E2E — práctica" (3 preguntas, respuesta "b") | `test-screen.spec` | Aislado de Constitución para que nada de onboarding/daily-limit le afecte |
| "Tema de prueba E2E — revisión" (3 preguntas en borrador) | `admin.spec` | Exclusivo de este spec: verificar/anular ahí no cambia los recuentos que miran los demás |

El mini-test del onboarding sí mezcla Constitución + práctica (así es la
ruta real, `/preguntas/aleatorias` sin `temaId`), así que su resultado
exacto no es determinista — el test solo comprueba que el flujo llega al
resumen, no un marcador concreto (ver comentario en `onboarding.spec.ts`
sobre por qué el recuento final en Home puede ser "5/6" o "6/6" según qué
tocó el mini-test, pero la precisión siempre es 100%).

Para login sin pasar por la UI (usuarios ya registrados, o el admin fijo
de `ADMIN_EMAILS=admin-e2e@example.com`), `e2e/helpers.ts` crea el usuario
vía API (`POST /auth/registro-bypass`, el bypass de autenticación exclusivo
de E2E — ver `backend/docs/clerk.md`) y luego inyecta el token resultante
en `localStorage` con `page.addInitScript(...)` antes de la primera
navegación — así `test-screen.spec` y `admin.spec` no dependen del flujo
de onboarding para tener una cuenta.

### Bugs reales que encontró esta suite

Escribir el test del límite diario (agotar 20 respuestas seguidas a la
misma pregunta vía API) hizo saltar dos bugs de producción que ningún
test anterior cubría:

1. **Intervalo SM-2 sin tope → fecha inválida.** `siguienteEstadoSM2`
   multiplica el intervalo por el factor de facilidad en cada acierto sin
   límite superior; tras ~17 aciertos seguidos a la misma pregunta el
   intervalo en días desborda el rango válido de `Date`, y Prisma rechaza
   la fecha resultante al guardar `proximaRevision`. Arreglado con un tope
   de 3650 días (~10 años) en `backend/src/lib/sm2.ts`.
2. **Un error async sin capturar tumbaba todo el servidor.** Express 4 no
   espera la promesa de un handler async: si rechaza, el error nunca llega
   al middleware de errores y se convierte en un `unhandledRejection` a
   nivel de proceso — que Node 15+ mata por defecto. El bug de SM-2 de
   arriba se disparaba en `POST /preguntas/:id/responder` y **tumbaba el
   backend entero para todos los usuarios**, no solo la petición que
   fallaba. Arreglado envolviendo todos los handlers async con
   `asyncHandler` (`backend/src/lib/asyncHandler.ts`), que captura el
   rechazo y lo pasa a `next(err)`.

Verificación manual de que el segundo arreglo aguanta: 25 llamadas
seguidas a `/responder` con `FREE_PLAN_DAILY_LIMIT=20` devuelven 20×`200`
y 5×`429` (nunca una conexión caída), y `/api/health` sigue respondiendo
después.

3. **Las claves reales de `.env` se filtraban a `.env.e2e` por dos vías
   independientes, rompiendo el aislamiento.** Al añadir claves reales de
   Clerk a `backend/.env` para probar el login en local, la suite E2E
   completa se rompió (toda petición se colgaba o devolvía 500) aunque
   `.env.e2e` nunca las define. La causa, en dos sitios distintos:
   - **Backend**: `@prisma/client` carga su propio `.env` por defecto al
     inicializarse (una funcionalidad documentada de Prisma, no un bug
     suyo) — cualquier variable que `.env.e2e` no defina explícitamente
     se rellena sola con el valor real de `backend/.env`. Con
     `CLERK_SECRET_KEY`/`CLERK_PUBLISHABLE_KEY` filtradas así, `app.ts`
     montaba el `clerkMiddleware()` **real** en vez del paso-a-través, y
     ese middleware intentaba una negociación con Clerk (cookie/handshake
     de "dev browser") que, sin red hacia clerk.com, dejaba la petición
     colgada — de ahí el "Cargando…" indefinido en la UI. `STRIPE_SECRET_KEY`
     se filtraba igual, y `/crear-checkout-session` acababa llamando de
     verdad a `api.stripe.com` (bloqueado) en vez de fallar limpio por
     falta de clave.
   - **Frontend**: Vite carga en cascada `.env` + `.env.[modo]`, así que
     `VITE_CLERK_PUBLISHABLE_KEY` (ausente en `frontend/.env.e2e` a
     propósito) también se rellenaba con la real de `frontend/.env`,
     activando `SessionProviderClerk` en vez del modo de bypass — que
     entonces se quedaba esperando para siempre a que cargara el script
     de Clerk (bloqueado).

   Además, `server.ts` cargaba su propio `.env` por defecto
   (`import "dotenv/config"`) incluso cuando ya se había arrancado
   envuelto en `dotenv -e .env.e2e --`, duplicando el mismo problema por
   una tercera vía.

   Arreglo, en dos partes:
   1. `server.ts` ya no carga ningún `.env` por su cuenta — cada script de
      `package.json` (`dev`, `test`, `e2e:serve`...) es responsable de
      envolver su propio arranque con `dotenv -e <archivo>`.
   2. `.env.e2e`/`.env.test` (backend) y `.env.e2e` (frontend) definen
      **explícitamente vacías** las claves de Clerk/Stripe en vez de
      omitirlas — un valor vacío sí cuenta como "ya definida" tanto para
      Prisma como para Vite, así que bloquea el relleno con la real. Ver
      los comentarios en esos archivos y en `backend/docs/clerk.md`.

   La lección general: en cualquier mecanismo de entornos en cascada
   (Prisma, Vite, dotenv-cli con varios `-e`...), una variable sensible
   que un entorno "aislado" quiere mantener sin definir debe fijarse
   **vacía explícitamente**, nunca dejarse ausente y confiar en que nadie
   la rellene desde un archivo más genérico.
