# Newsletter: consentimiento RGPD, doble opt-in, y envío de emails con Resend

## 1. Qué hace hoy

Captura de suscriptores conforme a RGPD (consentimiento explícito +
fecha, guardados en base de datos), el doble opt-in completo (alta →
email de confirmación → token de confirmación → email de
bienvenida), y baja por token. El envío real de los emails va por
[Resend](https://resend.com) (`backend/src/lib/resend.ts`); las
plantillas están en `backend/src/lib/emailTemplates.ts`.

Dos emails, ambos con el enlace de baja en el pie (obligatorio por
RGPD/LSSI-CE en cualquier comunicación por suscripción — vive en el
envoltorio común de las plantillas, así que no hay forma de mandar un
email de la newsletter sin él):

1. **Confirmación** (al darse de alta): enlace a
   `${FRONTEND_URL}/newsletter/confirmar?token=<tokenConfirmacion>`.
2. **Bienvenida** (al confirmar): enlace de vuelta a la app.

### Qué pasa sin RESEND_API_KEY, o si Resend falla

`POST /suscribir` sigue guardando el consentimiento con total
normalidad — el envío del email es un paso aparte (`enviarEmail` en
`routes/newsletter.ts`), envuelto en try/catch, que nunca hace fallar
la petición ni deshace el alta ya escrita en base de datos. Si
`RESEND_API_KEY` no está definida (dev/test, o producción antes de
configurarla) o Resend devuelve un error, solo queda un
`console.error` con el motivo. Es una decisión deliberada: lo que
RGPD exige poder demostrar es el consentimiento y su fecha, no que el
email haya llegado — así que un fallo de entrega no debe ocultar ni
revertir esa alta.

## 2. Cómo darse de alta en Resend (esto lo hace quien despliega, no Code)

1. Cuenta gratuita en [resend.com](https://resend.com).
2. Mientras Aprobox no tenga dominio propio, usar el dominio de
   pruebas: el remitente tiene que ser exactamente
   `Aprobox <onboarding@resend.dev>` (variable `RESEND_FROM_EMAIL`,
   ver `.env.example`). **Importante**: en modo pruebas, Resend solo
   entrega emails a la dirección de la propia cuenta de Resend (la
   que usaste para registrarte) — para probar con otro email primero
   hay que verificar un dominio propio en Resend (Dashboard → Domains)
   y cambiar `RESEND_FROM_EMAIL` a una dirección de ese dominio.
3. Dashboard → API Keys → crear una nueva. Copiarla a
   `RESEND_API_KEY` en `backend/.env` (local) y como variable de
   entorno en Render (producción) — nunca hardcodeada en el código ni
   commiteada.

## 3. Modelo de datos

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

## 4. Endpoints

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

## 5. Dónde se usa en el frontend

- `NewsletterForm` (`frontend/src/components/NewsletterForm.tsx`):
  formulario reutilizable con el checkbox de consentimiento sin
  premarcar y el botón de enviar deshabilitado hasta que se marca.
  Usado en la Landing pública y en Perfil.
- `/newsletter/confirmar` y `/newsletter/baja`
  (`frontend/src/pages/NewsletterConfirmar.tsx` /
  `NewsletterBaja.tsx`): páginas públicas que leen el `token` de la
  query string y llaman al endpoint correspondiente.

## 6. Tests

`backend/src/routes/__tests__/newsletter.test.ts` mockea Resend por
completo (nunca llama a la API real, ni falta ni hace falta
`RESEND_API_KEY` en test) y cubre: rechazo sin consentimiento
explícito, alta con fecha registrada, que el email de confirmación
sale con los enlaces de confirmación y baja correctos, que un fallo
de Resend no impide guardar el alta, idempotencia del alta repetida,
poder re-suscribirse tras una baja, que confirmar dispara también el
email de bienvenida, y confirmación/baja por token (válido e
inválido).

## 7. Probar el flujo completo en local con Resend real

1. Sigue la sección 2 para tener una API key de Resend.
2. En `backend/.env`, añade `RESEND_API_KEY` (tu clave real) y deja
   `RESEND_FROM_EMAIL` con el valor por defecto del dominio de
   pruebas.
3. Arranca el backend y el frontend en local (`npm run dev` en cada
   uno) y usa el formulario de newsletter (Landing o Perfil) con el
   email de tu propia cuenta de Resend — en modo pruebas es el único
   destino al que Resend entrega de verdad (ver sección 2).
4. Deberías recibir el email de confirmación con el botón "Confirmar
   mi suscripción"; al pulsarlo, se abre
   `/newsletter/confirmar?token=...` en el frontend, que llama al
   endpoint y muestra el mensaje de confirmado.
5. Justo después debería llegar el email de bienvenida.
6. El enlace "Darme de baja" del pie de cualquiera de los dos abre
   `/newsletter/baja?token=...`, que también llama a su endpoint y
   confirma la baja.
7. Revisa los logs del backend: cualquier fallo de envío queda como
   `[newsletter] Resend rechazó el envío...` o
   `[newsletter] No se pudo enviar el email...`, aunque la suscripción
   se haya guardado igual.
