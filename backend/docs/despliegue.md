# Despliegue: backend en Render, frontend en Vercel

Guía para dar de alta los dos servicios. Todo lo que puede vivir en código
(CORS, cómo se generan/migran las tablas, los comandos de build/start) ya
está resuelto en el repo; esta guía cubre lo que solo se configura en cada
dashboard.

## Resumen de la arquitectura de despliegue

```
Vercel (frontend, estático)  --->  Render (backend, Node/Express)  --->  Postgres
        │                                   │
        └── VITE_API_URL                    └── FRONTEND_URL (CORS + redirects de Stripe)
```

Hay una dependencia circular de URLs: el frontend necesita saber dónde
está el backend (`VITE_API_URL`) y el backend necesita saber dónde está
el frontend (`FRONTEND_URL`, para CORS y para las URLs de éxito/
cancelación de Stripe). Por eso el orden recomendado es:

1. Desplegar el backend en Render primero (con `FRONTEND_URL` apuntando
   provisionalmente a `http://localhost:5173` o dejándolo en blanco —
   sin él, CORS solo permite los orígenes de desarrollo, así que el
   backend funciona igual mientras tanto, solo el frontend en producción
   no podrá llamarlo aún).
2. Copiar la URL pública que Render asigna al backend
   (`https://tu-servicio.onrender.com`).
3. Desplegar el frontend en Vercel con `VITE_API_URL` apuntando a esa URL
   (+ `/api`).
4. Copiar la URL pública que Vercel asigna al frontend
   (`https://tu-proyecto.vercel.app`).
5. Volver a Render y poner `FRONTEND_URL` a esa URL real. Redesplegar
   (o dejar que Render lo haga solo si detecta el cambio de variable).

## Backend en Render

**Tipo de servicio**: Web Service, entorno Node.

| Campo | Valor |
|---|---|
| Root Directory | `backend` |
| Build Command | `npm install && npm run build` |
| Start Command | `npm run start:prod` |
| Health Check Path | `/api/health` |

`npm install` dispara `postinstall` (`prisma generate`), así que el
cliente de Prisma queda generado contra el `schema.prisma` de este repo
antes de compilar — sin este paso, `@prisma/client` no tiene los tipos ni
el motor correctos y el arranque falla. `prisma` está en
`dependencies` (no en `devDependencies`) precisamente porque hace falta
en tiempo de ejecución para el siguiente punto.

### Migraciones: `prisma migrate deploy` en el arranque

`npm run start:prod` es `prisma migrate deploy && node dist/server.js`:
antes de arrancar el servidor, aplica las migraciones pendientes contra
`DATABASE_URL`. `migrate deploy` (a diferencia de `migrate dev`) nunca
pide confirmación, nunca resetea datos y solo aplica las migraciones que
falten — seguro para producción, e idempotente (si no hay ninguna
pendiente, no hace nada, como ya se ve en local con
`No pending migrations to apply.`).

Si tu plan de Render tiene el campo **Pre-Deploy Command** (aplica las
migraciones antes de que la nueva versión reciba tráfico, en vez de en
cada arranque), es la opción más limpia: pon ahí
`npx prisma migrate deploy` y deja el Start Command como `npm start`
(`node dist/server.js`, sin migrar). Si no lo tienes disponible,
`npm run start:prod` como Start Command hace exactamente lo mismo, solo
que en cada arranque/reinicio del servicio en vez de una sola vez antes
del despliegue — con un único servicio (sin escalar a varias instancias
a la vez) no hay ningún riesgo de que dos migraciones corran en paralelo.

### Variables de entorno (Render → Environment)

Cópialas tal cual de tu `backend/.env` local, **salvo las marcadas
"cambia"**:

| Variable | De dónde sale | Notas |
|---|---|---|
| `DATABASE_URL` | Tu Postgres de producción | **Cambia**: no reutilices la de tu `.env` local. Si usas el Postgres gestionado de Render, él mismo te da esta cadena al crear la base de datos. |
| `CLERK_SECRET_KEY` | `backend/.env` | Igual que en local (misma instancia de Clerk), a menos que crees una instancia de Clerk separada para producción. |
| `CLERK_PUBLISHABLE_KEY` | `backend/.env` | Idem. |
| `STRIPE_SECRET_KEY` | `backend/.env` | Mientras sigas en modo test de Stripe, la misma. Para cobrar de verdad, cámbiala por tu clave `sk_live_...`. |
| `STRIPE_PRICE_ID` | `backend/.env` | Si usas claves `live` de Stripe, este id también debe ser el del precio creado en modo live (los ids de test y live no son intercambiables). |
| `STRIPE_WEBHOOK_SECRET` | Dashboard de Stripe | **Cambia**: no reutilices el de `stripe listen` en local. Créala al dar de alta el endpoint de webhook (ver más abajo). |
| `FRONTEND_URL` | La URL que te da Vercel | **Cambia**: `https://tu-proyecto.vercel.app` (o tu dominio propio). Sin `https://` de más ni barra final. |
| `ADMIN_EMAILS` | `backend/.env` | Los emails con acceso a `/admin/revision`. |
| `FREE_PLAN_DAILY_LIMIT` | `backend/.env` | Opcional, por defecto 30 si se omite. |

No hace falta configurar `PORT`: Render lo inyecta solo y `server.ts` ya
lee `process.env.PORT`. Tampoco hace falta (ni existe) un archivo `.env`
en el contenedor de Render: `server.ts` no carga ninguno por su cuenta —
las variables las inyecta la plataforma directamente en `process.env`, y
`@prisma/client` (que sí busca un `.env` por su cuenta al inicializarse,
ver `backend/docs/testing.md`) simplemente no encuentra ninguno y no hace
nada. Ese comportamiento de Prisma solo importa en local, para
`.env.test`/`.env.e2e` — en Render no hay ningún `.env` con el que
mezclarse.

`STRIPE_PUBLISHABLE_KEY` de tu `.env` local **no hace falta** en Render —
el backend nunca la lee (el Checkout es hosted por Stripe, sin Stripe.js
en el frontend, ver `backend/docs/stripe.md`).

**Nunca definas `AUTH_TEST_BYPASS_SECRET` en Render.** Esa variable
existe solo para que Playwright se salte a Clerk en el entorno E2E (ver
`backend/docs/clerk.md`); si se define en producción, cualquiera que
conozca el valor podría autenticarse como el usuario que quisiera sin
pasar por Clerk. El código nunca la define por defecto — hay que
copiarla ahí a propósito, así que basta con no hacerlo.

### CORS

`app.ts` ya solo permite peticiones de navegador desde
`http://localhost:5173`, `http://localhost:5174` (desarrollo/E2E) y
`process.env.FRONTEND_URL`. En cuanto `FRONTEND_URL` tenga la URL real de
Vercel, el frontend de producción queda autorizado — no hace falta tocar
código para esto, solo esa variable.

### El webhook de Stripe en producción

En el Dashboard de Stripe (modo test o live, el que estés usando), crea
un endpoint de webhook apuntando a
`https://tu-servicio.onrender.com/api/stripe/webhook`, suscrito a
`checkout.session.completed`, `customer.subscription.created`,
`customer.subscription.updated`, `customer.subscription.deleted` e
`invoice.payment_failed` (los mismos que maneja `routes/stripeWebhook.ts`,
ver `backend/docs/stripe.md`). Stripe te da el `whsec_...` de ese
endpoint al crearlo — es el valor de `STRIPE_WEBHOOK_SECRET` en Render.

## Frontend en Vercel

| Campo | Valor |
|---|---|
| Root Directory | `frontend` |
| Framework Preset | Vite (Vercel lo detecta solo) |
| Build Command | (el de por defecto: `npm run build`) |
| Output Directory | (el de por defecto: `dist`) |

`frontend/vercel.json` añade un rewrite (`/(.*) → /index.html`) para que
las rutas de React Router (`/perfil`, `/upgrade`, `/practicar/:id`...)
funcionen al entrar por enlace directo o al refrescar, no solo navegando
desde `/` dentro de la app.

### Variables de entorno (Vercel → Settings → Environment Variables)

| Variable | De dónde sale | Notas |
|---|---|---|
| `VITE_API_URL` | La URL que te da Render | `https://tu-servicio.onrender.com/api` (con el `/api` al final). |
| `VITE_CLERK_PUBLISHABLE_KEY` | `frontend/.env` | La misma clave publicable que en local, a menos que uses una instancia de Clerk separada para producción. |

No hace falta ninguna variable de Stripe en el frontend: el botón
"Suscribirme" solo llama a `/api/stripe/crear-checkout-session` y
redirige a la URL que devuelve el backend.

## Después de desplegar: checklist en el dashboard de Clerk

El CORS de nuestro backend y las variables de arriba no son lo único que
mira un dominio nuevo — Clerk **también** valida por su cuenta desde qué
dominios puede cargarse su propio script y completar el login. En
dashboard.clerk.com, en tu instancia (la misma de `CLERK_SECRET_KEY`),
añade la URL de Vercel a los dominios/orígenes permitidos de la
aplicación antes de probar el login en producción — si no, el mismo
`ERR_TUNNEL_CONNECTION_FAILED`/bloqueo que se documentó en
`backend/docs/clerk.md` para este entorno de desarrollo puede reaparecer
por un motivo distinto (dominio no autorizado, no red bloqueada) si se
omite este paso.

## Verificación rápida tras el despliegue

1. `curl https://tu-servicio.onrender.com/api/health` → `{"ok":true}`.
2. Abrir `https://tu-proyecto.vercel.app`, completar el onboarding y
   registrarte con Clerk de verdad — confirma que `/home` ya refleja el
   primer test practicado (reclamo de la sesión anónima) y que `/perfil`
   muestra tu email y tu plan.
3. Si tienes cuenta en `ADMIN_EMAILS`, entra a `/admin/revision` y
   confirma que carga la cola de revisión.
4. Agota el límite diario (o entra directo a `/upgrade` autenticado) y
   pulsa "Suscribirme": debe redirigir a Stripe Checkout de verdad, no
   dar un 500 (si da 500, revisa `STRIPE_SECRET_KEY`/`STRIPE_PRICE_ID` en
   Render).
