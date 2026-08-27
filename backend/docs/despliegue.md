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

### Migraciones y el banco de preguntas en el arranque

`npm run start:prod` es:

```
prisma migrate deploy && (node dist/scripts/import-questions.js || true) && node dist/server.js
```

Tres pasos, en orden:

1. **`prisma migrate deploy`** aplica las migraciones pendientes contra
   `DATABASE_URL`. A diferencia de `migrate dev`, nunca pide confirmación,
   nunca resetea datos y solo aplica las que falten — seguro para
   producción, e idempotente (si no hay ninguna pendiente, no hace nada,
   como ya se ve en local con `No pending migrations to apply.`). Si esto
   falla, el `&&` corta la cadena: el servidor **no** arranca — correcto,
   arrancar con un esquema desactualizado sería peor.
2. **`node dist/scripts/import-questions.js`** (la versión compilada del
   mismo script de `npm run import:questions`) sincroniza el banco de
   preguntas real (`backend/data/preguntas_auxiliar_estado_combinado.json`)
   contra la base de datos, en cada arranque — pensado para planes de
   Render sin acceso a Shell, donde no hay forma de ejecutarlo a mano
   (ver `backend/docs/banco-preguntas.md` para el detalle completo:
   qué tiene el dataset, por qué es seguro repetirlo en cada arranque sin
   duplicar ni pisar preguntas ya verificadas por un admin, y las
   alternativas si en algún momento sí tienes Shell).
3. El `|| true` hace que un fallo en el import (p.ej. un problema
   transitorio de conexión) **no** impida que el servidor arranque — se
   registra el error en los logs, pero no tumba el despliegue.
   `prisma migrate deploy` no lleva ese mismo tratamiento a propósito:
   si las migraciones fallan, el servidor sí debe quedarse sin arrancar.

Si tu plan de Render sí tiene el campo **Pre-Deploy Command** (corre
antes de que la nueva versión reciba tráfico, en vez de en cada
arranque), puedes mover ahí `npx prisma migrate deploy` y dejar el Start
Command como `npm start` — pero con el plan free (sin Pre-Deploy Command
ni Shell) `npm run start:prod` tal cual es la única vía, y hace
exactamente lo mismo salvo que corre en cada arranque/reinicio en vez de
una sola vez. Con un único servicio (el plan free no escala a varias
instancias a la vez) no hay ningún riesgo de que dos migraciones o dos
imports corran en paralelo.

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
   `start:prod` ya importa el dataset de preguntas en cada arranque (ver
   arriba), así que no hace falta ningún paso manual aparte — solo
   confirma que el log de arranque en Render muestra la línea
   `Importación completada: ...` con los números que esperas. Detalle
   completo en [`backend/docs/banco-preguntas.md`](banco-preguntas.md).
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

### "Unexpected token '<', <!DOCTYPE... is not valid JSON"

Si cualquier llamada a la API falla con este error nada más entrar,
`VITE_API_URL` no está llegando como URL absoluta al bundle de producción,
así que las peticiones acaban como rutas relativas (`/preguntas/temas` en
vez de `https://tu-servicio.onrender.com/api/preguntas/temas`) — el
navegador las resuelve contra el propio dominio de Vercel, cuyo
`vercel.json` (rewrite SPA) responde con `index.html` para cualquier ruta
que no sea un archivo estático, y eso es HTML donde se esperaba JSON.
`frontend/src/api/client.ts` ya cae a un valor por defecto si
`VITE_API_URL` falta o queda vacía, y avisa por consola si no parece una
URL absoluta — pero ese aviso no sustituye a configurarla bien. Para
arreglarlo:

1. En Vercel → Settings → Environment Variables, confirma que
   `VITE_API_URL` es la URL **completa** del backend, con `https://` y
   terminada en `/api` (`https://tu-servicio.onrender.com/api`) — nunca
   solo `/api` ni el dominio sin `https://`.
2. Confirma que está definida para el entorno que estás probando
   (Production/Preview/Development son configuraciones separadas en
   Vercel).
3. **Vuelve a desplegar** después de cambiarla: Vite incrusta
   `VITE_API_URL` en el bundle en el momento del build, no la lee en
   tiempo de ejecución — cambiar la variable sin redesplegar no tiene
   ningún efecto sobre un build ya hecho.
