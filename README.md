# Oposiciones App — Auxiliar Administrativo del Estado

App de preparación de oposiciones con banco de preguntas, mini-test sin
registro, repetición espaciada (SM-2), panel de progreso, frontend web
responsive y suscripción premium mensual vía Stripe (modo test/sandbox).

## Estado actual

- ✅ Modelo de datos (Prisma / PostgreSQL): temas, preguntas, usuarios,
  progreso SM-2, intentos.
- ✅ Importación del dataset `preguntas_auxiliar_estado_combinado.json`
  (414 preguntas, 28 temas).
- ✅ API REST: auth, mini-test sin registro, respuesta a preguntas,
  "repasar hoy" con SM-2, progreso por tema, racha, evolución del %
  de acierto, límite diario del plan gratuito.
- ✅ Tests de integración del flujo borrador/verificada/anulada (ver
  [`backend/docs/estados-preguntas.md`](backend/docs/estados-preguntas.md)).
- ✅ Frontend (React + Vite + Tailwind): onboarding sin registro (mini-test
  → nivel de partida → primer test sobre Constitución → alta de cuenta),
  home con progreso por tema y racha, test una pregunta a la vez con
  feedback y fuente, panel de progreso, pantalla de upgrade al alcanzar
  el límite diario.
- ✅ Herramienta de revisión editorial (`/admin/revision`, solo para
  cuentas listadas en `ADMIN_EMAILS`): cola de preguntas en borrador
  filtrable por bloque/tema, edición de enunciado/opciones/respuesta/
  explicación/fuente, verificar o anular.
- ✅ Tests de frontend: componentes (Vitest + Testing Library, API
  mockeada) y E2E (Playwright, contra un backend+frontend+BD dedicados —
  ver [`backend/docs/testing.md`](backend/docs/testing.md)).
- ✅ Suscripción premium mensual con Stripe (modo test): botón
  "Suscribirme" en `/upgrade` crea una Checkout Session; un webhook
  sincroniza el estado de la suscripción (`plan`/`premiumHasta`), lo que
  automáticamente exime del límite diario — ver
  [`backend/docs/stripe.md`](backend/docs/stripe.md).

## Estructura

```
backend/
  prisma/schema.prisma        modelo de datos
  data/*.json                 dataset de preguntas (copia del original)
  src/
    server.ts / app.ts        servidor y app de Express (separados para poder testear)
    routes/                   auth, preguntas, progreso
    lib/                      prisma client, SM-2, límite diario, reclamo de intentos anónimos
    scripts/import-questions.ts   importador idempotente del JSON
frontend/
  src/
    api/                      cliente fetch tipado
    context/SessionContext    token, sesión anónima, nivel de onboarding pendiente
    components/               TestRunner (motor de test), tarjetas, gráfico de evolución
    pages/onboarding/         mini-test → nivel → primer test (Constitución) → alta de cuenta
    pages/                    Home, Progreso, RepasarHoy, PracticarTema, Upgrade, Login
```

## Modelo de datos

- **Tema**: bloque (I/II) + número + nombre. Único por (bloque, número).
- **Pregunta**: reutiliza el `id` del dataset (p.ej. `q0001`) como clave
  primaria para poder re-importar sin duplicar. Incluye tipo
  (teórica/psicotécnica), origen, estado de verificación
  (borrador/verificada/anulada), convocatoria, fuente y explicación
  (de cara a añadir feedback enriquecido más adelante).
- **Usuario**: email/password, `nivelInicial` (resultado del onboarding),
  plan (free/premium), `esAdmin` (acceso a la revisión editorial — ver
  variables de entorno).
- **Progreso**: una fila por (usuario, pregunta) con los parámetros del
  algoritmo SM-2 (repeticiones, factor de facilidad, intervalo en días,
  próxima revisión).
- **Intento**: log de cada respuesta dada (usuario autenticado o sesión
  anónima), usado para el panel de progreso y para aplicar el límite
  diario del plan gratuito.

Solo las preguntas con `estado = verificada` se sirven en el mini-test y
en el repaso por defecto; el resto (`borrador`) queda disponible en la
base de datos a la espera de revisión editorial, y `anulada` nunca se
sirve para responder. El detalle completo de este flujo (qué endpoint
mira qué, comportamiento intencional vs. pendiente) está en
[`backend/docs/estados-preguntas.md`](backend/docs/estados-preguntas.md).

## Puesta en marcha (desarrollo local)

Requiere Node 20+ y una base de datos PostgreSQL (se incluye
`docker-compose.yml` para levantarla fácilmente).

```bash
cd backend
cp .env.example .env
npm install

# Base de datos (requiere Docker; alternativamente usa un Postgres local
# y ajusta DATABASE_URL en .env)
docker compose up -d

npm run prisma:migrate      # crea las tablas
npm run import:questions    # importa el dataset de preguntas

npm run dev                 # arranca el backend en http://localhost:3001
```

> Nota: en este entorno de desarrollo remoto Docker no estaba disponible,
> así que el esqueleto se validó contra un PostgreSQL local instalado en
> el sistema; con Docker funcionando, `docker compose up -d` es el camino
> recomendado.

### Variables de entorno (`backend/.env`)

- `DATABASE_URL`: cadena de conexión PostgreSQL.
- `JWT_SECRET`: secreto para firmar los tokens de sesión.
- `PORT`: puerto del backend (por defecto 3001).
- `FREE_PLAN_DAILY_LIMIT`: nº máximo de preguntas/día en el plan gratuito
  (por defecto 30).
- `ADMIN_EMAILS`: emails (separados por comas) con acceso a la revisión
  editorial. Se activa solo (`Usuario.esAdmin = true`) la próxima vez que
  ese email se registre o inicie sesión — no hace falta tocar la BD.

### Re-importar el dataset

El script es idempotente (upsert por `id`), así que se puede volver a
ejecutar tras corregir o ampliar el JSON:

```bash
npm run import:questions
# o apuntando a otro archivo:
npm run import:questions -- /ruta/a/otro_dataset.json
```

## Frontend

```bash
cd frontend
cp .env.example .env   # VITE_API_URL, por defecto http://localhost:3001/api
npm install
npm run dev            # http://localhost:5173, requiere el backend corriendo
```

Ver [`frontend/README.md`](frontend/README.md) para la estructura y el
flujo de sesión anónima → cuenta (el onboarding se responde sin cuenta con
un `sesionAnonima` en localStorage; al registrarse o iniciar sesión justo
después, esos intentos se reasignan al usuario y su progreso SM-2 se
reconstruye — ver `backend/src/lib/reclamarIntentosAnonimos.ts` — para que
el Home no muestre todo en cero nada más registrarse).

## Stripe

Suscripción premium mensual completa: Checkout Session desde `/upgrade` +
webhook que mantiene al día `Usuario.plan`. Detalle completo del flujo,
cómo se deriva `plan`/`premiumHasta` de cada evento, y cómo probarlo con
`stripe listen` en local, en
[`backend/docs/stripe.md`](backend/docs/stripe.md).

### Variables de entorno (`backend/.env`, nunca en el repo)

- `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY`: claves de tu cuenta de
  Stripe **en modo test** (`sk_test_...` / `pk_test_...`). Solo la secreta
  se usa en el backend; la publicable no hace falta en el frontend
  mientras el checkout sea el hosted de Stripe (redirect por `session.url`,
  sin Stripe.js).
- `STRIPE_PRICE_ID`: id del precio recurrente mensual (`price_...`), creado
  con `npm run stripe:setup-producto` (o a mano en el Dashboard).
- `STRIPE_WEBHOOK_SECRET`: firma del endpoint de webhook (`whsec_...`),
  la da `stripe listen` en local o el Dashboard en producción.
- `FRONTEND_URL`: origen del frontend (por defecto
  `http://localhost:5173`), para las URLs de éxito/cancelación del Checkout.

### Crear el producto/precio (`npm run stripe:setup-producto`)

`backend/src/scripts/setup-stripe-product.ts` crea (una sola vez, es
idempotente vía `lookup_key: "premium-mensual"`) el producto "Premium
mensual" y su precio de 4,99 €/mes recurrente. Este entorno de desarrollo
tiene bloqueada la salida directa a `api.stripe.com` por política de red
del sandbox, así que el producto/precio se creó **a mano en el Dashboard
de Stripe** (fuera de este contenedor) y su id se guardó en `.env`.

```bash
cd backend
npm install          # trae el paquete `stripe`
npm run stripe:setup-producto
# imprime: STRIPE_PRICE_ID=price_...
# → añádelo a backend/.env
```

### Modelo de datos

`Usuario.plan`/`premiumHasta` siguen siendo el gate que usa el resto de
la app (p.ej. `lib/dailyLimit.ts`), y ahora los mantiene al día el webhook
de Stripe — nunca se escriben a mano. Campos nuevos: `stripeCustomerId`,
`stripeSubscriptionId` (únicos, uno de cada por usuario) y
`stripeSubscriptionStatus` (el string crudo que manda Stripe — solo
`active`/`trialing` habilitan `plan = premium`).

## Tests

```bash
# Backend (Vitest + Supertest, BD de test dedicada oposiciones_test)
cd backend && cp .env.test.example .env.test && npm test

# Frontend: componentes (Vitest + Testing Library, sin BD)
cd frontend && npm test

# Frontend: E2E (Playwright, backend+frontend+BD dedicados: puertos 3002/5174, oposiciones_e2e)
cd frontend
cp .env.e2e.example .env.e2e
cp ../backend/.env.e2e.example ../backend/.env.e2e
npm run test:e2e
```

Ninguna de las tres suites toca la base de datos de desarrollo. Ver
[`backend/docs/testing.md`](backend/docs/testing.md) para la estrategia
completa (qué cubre cada nivel, cómo está aislado el entorno de E2E, y dos
bugs reales de producción — desbordamiento de fecha en SM-2 y un error
async sin capturar que tumbaba todo el servidor — que esta suite encontró
al escribirla) y
[`backend/docs/estados-preguntas.md`](backend/docs/estados-preguntas.md#tests)
para el detalle del flujo borrador/verificada/anulada.

## API

Todas las rutas cuelgan de `/api`.

### Auth
- `POST /auth/registro` `{ email, password, nivelInicial?, sesionAnonima? }` → `{ token, usuario }`
- `POST /auth/login` `{ email, password, sesionAnonima? }` → `{ token, usuario }`
- `GET /auth/me` (Bearer token) → datos del usuario
- `PATCH /auth/me/onboarding` `{ nivelInicial }` → guarda el resultado del onboarding

### Preguntas
- `GET /preguntas/aleatorias?limit=10&tipo=teorica|psicotecnica&bloque=I|II&temaId=&estado=verificada|borrador`
  Mini-test sin registro: preguntas al azar **sin** la respuesta correcta.
  `temaId` filtra a un tema concreto (usado por el onboarding para el
  primer test sobre Constitución).
- `POST /preguntas/:id/responder` `{ opcion: "a"|"b"|"c"|"d", sesionAnonima?, tiempoMs? }`
  Funciona con o sin token (usa `sesionAnonima` si no hay usuario). Devuelve
  si acertó, la respuesta correcta, explicación/fuente y el estado del
  límite diario. Si hay usuario autenticado, actualiza su `Progreso` (SM-2).
- `GET /preguntas/temas` → catálogo de temas.

### Progreso (requieren `Authorization: Bearer <token>`)
- `GET /progreso/hoy?limit=20` → preguntas vencidas para repaso (SM-2) +
  preguntas nuevas hasta agotar el límite diario restante.
- `POST /progreso/:preguntaId/revisar` `{ calidad: 0-5 }` → aplica SM-2
  con una calidad explícita (para una UI tipo Anki: otra vez/difícil/bien/fácil).
  El frontend actual no la usa (usa `/responder` para todo, incluido el
  repaso), pero queda disponible para una UI de repaso alternativa.
- `GET /progreso/resumen` → totales, precisión, preguntas en seguimiento,
  pendientes de hoy y racha de días consecutivos.
- `GET /progreso/por-tema` → por cada uno de los 28 temas: preguntas
  verificadas, contestadas, aciertos y precisión (home + puntos débiles).
- `GET /progreso/evolucion?dias=14` → serie diaria de intentos/aciertos
  para el gráfico de evolución del % de acierto.

### Admin (requieren `Authorization: Bearer <token>` de un usuario con `esAdmin`)
- `GET /admin/preguntas?estado=borrador|verificada|anulada&bloque=&temaId=&sinTema=&limit=`
  → cola de revisión con la pregunta completa (incluida la respuesta),
  ordenada por tema.
- `GET /admin/resumen-temas?estado=` → nº de preguntas en ese estado por
  tema (y sin tema, para psicotécnicas), para pintar el filtro.
- `PATCH /admin/preguntas/:id` `{ enunciado?, opciones?, respuestaCorrecta?, explicacion?, fuente?, estado? }`
  → edita y/o cambia el estado. Rechaza (400) marcar `estado: "verificada"`
  si la pregunta no queda con una `respuestaCorrecta`.

### Stripe
- `POST /stripe/crear-checkout-session` (requiere sesión) → `{ url }`.
  Crea/reutiliza el Customer del usuario y una Checkout Session en modo
  suscripción; el frontend redirige el navegador a `url`.
- `POST /stripe/webhook` (público, verificado por firma
  `STRIPE_WEBHOOK_SECRET`) → sincroniza `plan`/`premiumHasta`/
  `stripeSubscriptionStatus` a partir de los eventos de Stripe. Ver
  [`backend/docs/stripe.md`](backend/docs/stripe.md) para el detalle de
  qué eventos maneja.

## Próximos pasos

1. **Reportar preguntas dudosas**: hoy `reportes_usuario` existe en el
   modelo pero no hay forma de incrementarlo desde la UI; añadir un botón
   "reportar" en el test y, cuando supere un umbral, degradar la pregunta
   a `borrador` para que vuelva a la cola de revisión.
2. **Stripe, siguiente nivel**: portal de cliente de Stripe (self-service
   para cancelar/cambiar tarjeta), y pasar de modo test a producción
   (claves live + endpoint de webhook real en el Dashboard).
3. **CI**: las tres suites de test corren en local; falta un workflow que
   las ejecute en cada push/PR (levantando Postgres como servicio).
