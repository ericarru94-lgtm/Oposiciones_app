# Oposiciones App — Auxiliar Administrativo del Estado

App de preparación de oposiciones con banco de preguntas, mini-test sin
registro, repetición espaciada (SM-2), panel de progreso y frontend web
responsive. La monetización de pago (cobro real) queda para una fase
posterior; el paywall/UI ya existe.

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
- ⬜ Cobro real (Stripe u otro proveedor) para el plan premium.
- ⬜ Herramienta de verificación editorial (borrador → verificada).

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
  plan (free/premium).
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

## Tests

```bash
cd backend
cp .env.test.example .env.test   # ajusta DATABASE_URL si hace falta
npm test
```

Usa una base de datos de test real y separada (no toca los datos de
desarrollo). `npm test` aplica las migraciones automáticamente antes de
correr la suite. Ver
[`backend/docs/estados-preguntas.md`](backend/docs/estados-preguntas.md#tests)
para el detalle de qué cubre cada test del flujo borrador/verificada/anulada.

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

## Próximos pasos

1. **Cobro real**: integrar un proveedor de pago (p.ej. Stripe) en la
   pantalla de upgrade, webhook de alta/renovación/cancelación que
   actualice `Usuario.plan` y `premiumHasta`.
2. **Verificación editorial**: herramienta/admin para pasar preguntas de
   `borrador` a `verificada` (añadir `explicacion`/`fuente`), y flujo de
   `reportes_usuario` para que los usuarios señalen preguntas dudosas.
3. **Tests de frontend**: la suite de tests hoy solo cubre el backend; el
   flujo de onboarding se validó manualmente con Playwright (ver capturas
   generadas durante el desarrollo) pero no hay tests automatizados de UI
   todavía.
