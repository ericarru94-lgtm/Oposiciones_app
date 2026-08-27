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
cuelga de `Usuario.stripeCustomerId`). Si `/upgrade` se alcanza sin
sesión (límite agotado durante el onboarding, antes de registrarse),
la pantalla pide crear una cuenta en vez de mostrar el botón de pago.

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

`backend/src/routes/__tests__/stripe.test.ts` (11 tests) mockea
`lib/stripe.ts` por completo (`vi.mock` + `vi.hoisted`), así que corre
contra la BD de test real pero sin tocar la API de Stripe:

- Checkout: 401 sin token, crea/guarda un Customer nuevo, reutiliza uno
  existente, 500 si falta `STRIPE_PRICE_ID`.
- Webhook: 400 sin cabecera `stripe-signature`, 400 con firma inválida,
  `checkout.session.completed` activa premium con la fecha correcta,
  `customer.subscription.updated` con `past_due` degrada a free,
  `customer.subscription.deleted` cancela sin borrar `premiumHasta`, un
  evento de un customer desconocido no rompe nada, `invoice.payment_failed`
  no lanza.

No hay test E2E (Playwright) del click-through de Checkout: requeriría
red real hacia Stripe (bloqueada aquí) y depender de la página hospedada
de Stripe la haría lenta y frágil. El botón "Suscribirme" solo se
comprueba visible/habilitado en `e2e/daily-limit.spec.ts`, sin pulsarlo.
