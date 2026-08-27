# Oposiciones App — Auxiliar Administrativo del Estado

App de preparación de oposiciones con banco de preguntas, mini-test sin
registro, repetición espaciada (SM-2) y panel de progreso. Este repo
arranca por el **esqueleto de datos + backend**; el frontend y la
monetización llegan en fases posteriores.

## Estado actual

- ✅ Modelo de datos (Prisma / PostgreSQL): temas, preguntas, usuarios,
  progreso SM-2, intentos.
- ✅ Importación del dataset `preguntas_auxiliar_estado_combinado.json`
  (414 preguntas, 28 temas).
- ✅ API REST básica: auth, mini-test sin registro, respuesta a preguntas,
  "repasar hoy" con SM-2, resumen de progreso, límite diario del plan
  gratuito.
- ⬜ Frontend (onboarding, home, test, panel de progreso).
- ⬜ Monetización freemium (suscripción mensual).

## Estructura

```
backend/
  prisma/schema.prisma        modelo de datos
  data/*.json                 dataset de preguntas (copia del original)
  src/
    server.ts                 servidor Express
    routes/                   auth, preguntas, progreso
    lib/                      prisma client, SM-2, límite diario
    scripts/import-questions.ts   importador idempotente del JSON
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
sirve para responder.

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

## API

Todas las rutas cuelgan de `/api`.

### Auth
- `POST /auth/registro` `{ email, password, nivelInicial? }` → `{ token, usuario }`
- `POST /auth/login` `{ email, password }` → `{ token, usuario }`
- `GET /auth/me` (Bearer token) → datos del usuario
- `PATCH /auth/me/onboarding` `{ nivelInicial }` → guarda el resultado del onboarding

### Preguntas
- `GET /preguntas/aleatorias?limit=10&tipo=teorica|psicotecnica&bloque=I|II&estado=verificada`
  Mini-test sin registro: preguntas al azar **sin** la respuesta correcta.
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
- `GET /progreso/resumen` → totales, precisión, preguntas en seguimiento,
  pendientes de hoy (para el panel de progreso).

## Próximos pasos

1. **Frontend** (React/Vite + Tailwind sugerido): onboarding con nivel de
   partida, home con "repasar hoy", flujo de test con feedback y fuente,
   panel de progreso, mini-test sin registro usando `sesionAnonima`
   persistida en localStorage.
2. **Verificación editorial**: herramienta/admin para pasar preguntas de
   `borrador` a `verificada` (añadir `explicacion`/`fuente`), y flujo de
   `reportes_usuario` para que los usuarios señalen preguntas dudosas.
3. **Monetización freemium**: tabla de suscripciones + integración de
   pago (p.ej. Stripe), upgrade de `plan` a `premium` y `premiumHasta`,
   webhook de renovación/cancelación.
