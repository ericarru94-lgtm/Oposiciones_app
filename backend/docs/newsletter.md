# Newsletter: consentimiento RGPD, doble opt-in, y qué falta por hacer

## 1. Qué hace hoy y qué NO hace todavía

Implementado: captura de suscriptores conforme a RGPD (consentimiento
explícito + fecha, guardados en base de datos) y el esqueleto completo
del doble opt-in (alta → token de confirmación → token de baja).

**No implementado todavía: el envío real de emails.** No hay
proveedor de email conectado (Resend, SendGrid, Postmark...), así que
cuando alguien se suscribe, la fila queda en estado `pendiente` y el
enlace de confirmación solo se deja constatado en el log del servidor
(`[newsletter] Alta pendiente de confirmar para...`), no se envía a
ningún sitio. El encargo que originó esto lo permite explícitamente:
"no es necesario montar el envío de emails en esta fase si es
complejo — con la captura de suscriptores conforme a RGPD es
suficiente por ahora". Antes de anunciar la newsletter a usuarios
reales, hace falta:

1. Elegir un proveedor de email transaccional/marketing.
2. En `POST /api/newsletter/suscribir` (`backend/src/routes/newsletter.ts`),
   sustituir el `console.log` por el envío real del email de
   confirmación, con el enlace a
   `${FRONTEND_URL}/newsletter/confirmar?token=<tokenConfirmacion>`.
3. Cuando se implementen los envíos periódicos (recordatorios de
   racha, novedades), incluir siempre el enlace de baja:
   `${FRONTEND_URL}/newsletter/baja?token=<tokenBaja>` — el endpoint
   (`POST /api/newsletter/baja?token=...`) y la página
   (`/newsletter/baja`) ya existen y funcionan.

## 2. Modelo de datos

`NewsletterSuscriptor` (independiente de `Usuario`: se puede suscribir
alguien sin cuenta en la app, y viceversa):

- `email` (único).
- `consentimiento` + `fechaConsentimiento`: lo que RGPD exige poder
  demostrar. Se fija en el momento del alta y nunca se pisa.
- `estado`: `pendiente` → `confirmado` (o `baja` en cualquier momento).
- `tokenConfirmacion` / `tokenBaja`: aleatorios (`crypto.randomBytes`),
  únicos, uno para cada acción — nunca el mismo token sirve para las
  dos, para que un enlace de confirmación filtrado no permita además
  dar de baja a otra persona ni viceversa.
- `confirmadoEn` / `bajaEn`: para tener también la fecha de esos
  eventos, no solo la del consentimiento inicial.

## 3. Endpoints

- `POST /api/newsletter/suscribir` — body `{ email, consentimiento }`.
  Rechaza (400) cualquier valor de `consentimiento` que no sea
  `true` — el checkbox del frontend (`NewsletterForm.tsx`) nunca
  empieza marcado, así que solo llega `true` cuando el usuario lo ha
  marcado él mismo. Si el email ya está de alta (pendiente o
  confirmado), no crea una fila nueva ni reenvía nada — solo
  devuelve el estado actual. Si estaba de baja, permite un alta
  nueva (nuevos tokens, nuevo consentimiento).
- `GET /api/newsletter/confirmar?token=...` — segundo paso del doble
  opt-in. Idempotente si ya estaba confirmado; 410 si ya se dio de
  baja (evita "revivir" una baja con un enlace de confirmación viejo).
- `POST /api/newsletter/baja?token=...` — baja por token, sin
  necesidad de sesión (para que el enlace de cualquier email futuro
  funcione sin tener que iniciar sesión).

## 4. Dónde se usa en el frontend

- `NewsletterForm` (`frontend/src/components/NewsletterForm.tsx`):
  formulario reutilizable con el checkbox de consentimiento sin
  premarcar y el botón de enviar deshabilitado hasta que se marca.
  Usado en la Landing pública y en Perfil.
- `/newsletter/confirmar` y `/newsletter/baja`
  (`frontend/src/pages/NewsletterConfirmar.tsx` /
  `NewsletterBaja.tsx`): páginas públicas que leen el `token` de la
  query string y llaman al endpoint correspondiente.

## 5. Tests

`backend/src/routes/__tests__/newsletter.test.ts` cubre: rechazo sin
consentimiento explícito, alta con fecha registrada, idempotencia del
alta repetida, poder re-suscribirse tras una baja, confirmación y baja
por token (válido e inválido).
