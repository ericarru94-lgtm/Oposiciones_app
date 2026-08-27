# Stripe: suscripción premium mensual

Flujo completo: producto/precio en Stripe → Checkout Session desde
`/upgrade` → webhook que sincroniza el estado de la suscripción con
`Usuario`. El límite diario (`lib/dailyLimit.ts`) ya comprueba
`usuario.plan === "premium"`, así que en cuanto el webhook marca a un
usuario como premium, deja de aplicársele el límite sin ningún cambio
adicional.

## Piezas

| Pieza | Dónde |
|---|---|
| Cliente de Stripe (inicialización perezosa) | `backend/src/lib/stripe.ts` |
| Crear producto/precio (idempotente, un ejecutar puntual) | `backend/src/scripts/setup-stripe-product.ts` |
| Crear Checkout Session | `POST /api/stripe/crear-checkout-session` (`backend/src/routes/stripe.ts`) |
| Webhook | `POST /api/stripe/webhook` (`backend/src/routes/stripeWebhook.ts`) |
| Mapeo evento de Stripe → `Usuario` | `backend/src/lib/sincronizarSuscripcion.ts` |
| Botón "Suscribirme" | `frontend/src/pages/Upgrade.tsx` |

## Por qué el cliente de Stripe es perezoso

`lib/stripe.ts` no crea el cliente al importarse, solo cuando algo lo
llama de verdad (`obtenerStripe()`). Si fuera inmediato (como al
principio), el backend dejaría de arrancar sin `STRIPE_SECRET_KEY` —
rompiendo los entornos de test y E2E, que no tienen por qué configurar
Stripe. Con la inicialización perezosa, solo una petición que realmente
necesite Stripe puede fallar (500, capturado por `asyncHandler`), nunca
el arranque del servidor.

## El flujo de checkout

1. `POST /api/stripe/crear-checkout-session` (requiere sesión): si el
   usuario no tiene `stripeCustomerId`, crea un Customer en Stripe y lo
   guarda; si ya tiene uno, lo reutiliza. Crea una Checkout Session en
   modo `subscription` con `STRIPE_PRICE_ID`, y devuelve `session.url`.
2. El frontend hace `window.location.href = url` (Checkout hosted de
   Stripe — no se usa Stripe.js ni la clave publicable en el frontend).
3. Tras pagar, Stripe redirige a `${FRONTEND_URL}/home?checkout=success`
   (Home muestra un aviso de "pago completado"); si cancela, a
   `${FRONTEND_URL}/upgrade?checkout=cancelado`.

Solo un usuario autenticado puede suscribirse (el Customer de Stripe
cuelga de `Usuario.stripeCustomerId`, y `POST /crear-checkout-session`
exige `authRequerido` — ver `backend/docs/clerk.md` para cómo se resuelve
esa sesión con Clerk). Si `/upgrade` se alcanza sin sesión (límite
agotado durante el onboarding, antes de registrarse), el botón
"Suscribirme" (`frontend/src/pages/Upgrade.tsx`) no llama al backend:
navega a `/registro?destino=%2Fupgrade%3Fcontinuar%3D1` (el registro/login
real de Clerk, con un enlace "¿Ya tienes cuenta?" hacia `/login` con el
mismo destino). Al completar el alta, Clerk redirige de vuelta a
`/upgrade?continuar=1`, y `Upgrade` detecta ese parámetro para lanzar el
checkout automáticamente en cuanto `estaAutenticado` es true — sin que el
usuario tenga que pulsar "Suscribirme" una segunda vez.

Como el `Usuario` para un login de Clerk completamente nuevo se crea al
vuelo en la primera petición autenticada (`obtenerOCrearUsuarioDesdeClerk`,
ver `backend/docs/clerk.md`), esa primera llamada a
`/crear-checkout-session` tras registrarse ES la primera petición
autenticada de esa persona: la fila de `Usuario` se crea justo antes de
que la ruta la lea, así que el Customer de Stripe se crea con normalidad
para ella igual que para cualquier usuario existente (cubierto por un test
dedicado en `stripe.test.ts`, sin depender de un `GET /auth/me` previo).

## El webhook

`POST /api/stripe/webhook` verifica la firma con `STRIPE_WEBHOOK_SECRET`
contra el **body crudo** (por eso se monta con `express.raw()` antes del
`express.json()` global en `app.ts` — ver el comentario ahí). Eventos
que procesa:

| Evento | Efecto |
|---|---|
| `checkout.session.completed` | Recupera la Subscription creada y sincroniza |
| `customer.subscription.created` / `.updated` / `.deleted` | Sincroniza siempre a partir del objeto Subscription |
| `invoice.payment_failed` | Solo se registra en el log; el cambio de estado real (`past_due`) llega vía `customer.subscription.updated`, que Stripe dispara en paralelo |

`sincronizarSuscripcionDesdeStripe` busca el `Usuario` por
`stripeCustomerId` y actualiza:
- `stripeSubscriptionId`, `stripeSubscriptionStatus` (el string crudo de Stripe).
- `plan`: `"premium"` solo si el estado es `active` o `trialing`; cualquier
  otro (`past_due`, `canceled`, `unpaid`...) lo deja en `"free"`.
- `premiumHasta`: se actualiza al `current_period_end` del subscription
  item **solo mientras sigue siendo premium**; al cancelarse o impagarse
  no se borra — queda como registro de hasta cuándo estuvo cubierto.

Nota de API: `current_period_end` no vive en el objeto `Subscription` en
esta versión del SDK/API de Stripe, sino en
`subscription.items.data[0].current_period_end` — confirmado leyendo los
tipos instalados (`node_modules/stripe/cjs/resources/*.d.ts`), no asumido.

## Probarlo en local (fuera de este entorno)

Este entorno de desarrollo remoto tiene bloqueada la salida directa a
`api.stripe.com` (ver `backend/docs/testing.md` — no es específico de
Stripe, es la política de red del sandbox), así que el checkout/webhook
reales solo se han podido probar con el cliente de Stripe mockeado (ver
tests). Para probarlo de verdad:

```bash
# Terminal 1: backend normal
cd backend && npm run dev

# Terminal 2: reenvía los webhooks de tu cuenta de test a tu backend local
stripe listen --forward-to localhost:3001/api/stripe/webhook
# imprime: whsec_... -> pégalo en backend/.env como STRIPE_WEBHOOK_SECRET

# Terminal 3: frontend normal
cd frontend && npm run dev
```

Luego, desde la app: agota el límite diario o entra directamente a
`/upgrade` ya logueado, pulsa "Suscribirme", paga con una tarjeta de
prueba de Stripe (p.ej. `4242 4242 4242 4242`, cualquier fecha futura y
CVC), y confirma en los logs del backend que el webhook actualizó
`Usuario.plan` a `"premium"`.

## Tests

`backend/src/routes/__tests__/stripe.test.ts` (12 tests) mockea
`lib/stripe.ts` y `@clerk/express` por completo (mismo patrón
`vi.mock`/`vi.hoisted`, ver `backend/docs/clerk.md`), así que corre contra
la BD de test real pero sin tocar ninguna API externa:

- Checkout: 401 sin token, crea/guarda un Customer nuevo, reutiliza uno
  existente, **un usuario de Clerk que hace su primera petición
  autenticada directamente contra este endpoint (fila `Usuario` creada al
  vuelo) también consigue su Customer sin problema**, 500 si falta
  `STRIPE_PRICE_ID`.
- Webhook: 400 sin cabecera `stripe-signature`, 400 con firma inválida,
  `checkout.session.completed` activa premium con la fecha correcta,
  `customer.subscription.updated` con `past_due` degrada a free,
  `customer.subscription.deleted` cancela sin borrar `premiumHasta`, un
  evento de un customer desconocido no rompe nada, `invoice.payment_failed`
  no lanza.

No hay test E2E (Playwright) del click-through de Checkout real:
requeriría red real hacia Stripe (bloqueada aquí) y depender de la página
hospedada de Stripe la haría lenta y frágil. Lo que sí cubre
`e2e/upgrade-auth.spec.ts` es el tramo que sí depende de este proyecto: sin
sesión, "Suscribirme" lleva al registro/login real (Clerk o su bypass de
E2E) en vez de al backend, y al volver autenticado el checkout se dispara
solo (sin un segundo clic) — en este entorno acaba en un 500 porque
`STRIPE_SECRET_KEY` no está configurado en `.env.e2e` a propósito, lo cual
de todas formas confirma que la llamada se intentó. El botón "Suscribirme"
ya autenticado se comprueba visible/habilitado en `e2e/daily-limit.spec.ts`,
sin pulsarlo (evita depender de la página hospedada de Stripe).
