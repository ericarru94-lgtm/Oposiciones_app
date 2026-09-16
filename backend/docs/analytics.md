# Analítica de conversión (Google Analytics 4)

## 1. Qué hace hoy

Mide el funnel completo de Aprobox — visita → registro → alta premium —
para poder evaluar campañas de Google Ads/Meta Ads más adelante sin
depender de intuición. Piezas, todas en `frontend/src/`:

- **`lib/analytics.ts`**: inyecta `gtag.js` e inicializa el `dataLayer`
  solo si hay `VITE_GA_MEASUREMENT_ID` configurada y el visitante ha dado
  su consentimiento. Expone `registrarVistaPagina` (vistas de página) y
  `registrarEvento` (conversiones propias) — ambas son un no-op si
  Analytics no está cargado, así que el resto de la app puede llamarlas
  sin comprobar nada antes.
- **`components/AvisoCookies.tsx`**: banner de consentimiento (Aceptar/
  Rechazar) que aparece en la primera visita. Solo "Aceptar" llama a
  `cargarAnalytics()`; la decisión se guarda en `localStorage`
  (`aprobox-consentimiento-cookies`) para no volver a preguntar.
- **`App.tsx`**: monta el banner una vez a nivel de toda la app, y un
  componente `SeguimientoAnalytics` (dentro de `BrowserRouter`, para
  poder usar `useLocation`) que manda una vista de página en cada cambio
  de ruta — `gtag.js` por sí solo, en una SPA, solo ve la carga inicial
  del documento.
- **Tres eventos de conversión**, cada uno donde ya existía la lógica de
  negocio correspondiente:
  - `sign_up` — `context/SessionContext.tsx`, en el primer login de
    verdad detectado en ese navegador (antes de marcar el onboarding
    como completo).
  - `suscripcion_premium` — `pages/Home.tsx`, cuando llega
    `?checkout=success` desde Stripe.
  - `newsletter_alta` — `components/NewsletterForm.tsx`, en un alta
    nueva (no en un "ya estabas suscrito").

## 2. Por qué hay un banner de cookies (y no se carga sin más)

En España la AEPD exige consentimiento previo (opt-in) para cookies no
estrictamente necesarias, cookies analíticas incluidas — no basta con
avisar en una política y dejarlas activas por defecto. Por eso
`AvisoCookies` no es solo informativo: mientras el visitante no pulse
"Aceptar", ningún script de Google se llega a inyectar en la página (no
solo se bloquea el envío de datos, es que el script ni se descarga).

## 3. Variables de entorno

```
VITE_GA_MEASUREMENT_ID="G-XXXXXXXXXX"
```

Se obtiene creando una propiedad "Web" en
[analytics.google.com](https://analytics.google.com) (Admin → Flujos de
datos → tu flujo → Measurement ID). Sin ella, `analyticsConfigurado()`
devuelve `false` y tanto el banner como cualquier llamada a
`registrarEvento`/`registrarVistaPagina` son un no-op — la app funciona
exactamente igual, solo que sin medir nada.

## 4. Cómo se enlaza con Google Ads más adelante

Cuando exista una cuenta de Google Ads, basta con enlazarla a esta
propiedad de GA4 desde Google Ads → Herramientas → Vinculación de
cuentas — no hace falta tocar ningún código ni añadir un segundo script.
Los eventos `sign_up` y `suscripcion_premium` ya están para poder
importarlos como conversiones de Ads en cuanto se enlace.
