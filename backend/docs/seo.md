# SEO básico de aprobox.es

## Cómo está implementado

El frontend es una SPA de Vite/React servida como estática en Vercel (ver
`backend/docs/despliegue.md`) — no hay SSR ni prerender. Esto condiciona
cómo funciona el SEO:

| Pieza | Dónde | Cubre |
|---|---|---|
| Título/descripción/canonical/OG/Twitter por defecto | `frontend/index.html` | `/` y cualquier crawler que no ejecute JS |
| Título/descripción/canonical/OG/Twitter por página | `frontend/src/hooks/useSeo.ts`, llamado desde cada página pública (`Landing`, `Upgrade`, y `PaginaEstatica` para Contacto/legal) | Lo que ve Google al renderizar (sí ejecuta JS) y el DOM en todo momento |
| Datos estructurados (Organization + WebSite) | `frontend/src/components/OrganizationJsonLd.tsx`, solo en Landing | Rich results de Google |
| `robots.txt` / `sitemap.xml` | `frontend/public/robots.txt`, `frontend/public/sitemap.xml` | Rastreo e indexación |
| Imagen para compartir (`og:image`/`twitter:image`) | `frontend/public/og-image.png` (1200×630) | Vista previa en redes sociales |

### Limitación conocida: no hay per-page real para crawlers sin JS

`vercel.json` reescribe cualquier ruta a `index.html` (`Allow: /` en
`robots.txt` + ese rewrite es lo que hace posible que la SPA funcione en
Vercel). Esto significa que un crawler que **no** ejecute JavaScript
(la vista previa de enlaces de Facebook/Twitter/LinkedIn/Slack/WhatsApp,
principalmente) recibe siempre las etiquetas estáticas de `index.html` —
las de la Landing — sea cual sea la URL que se comparta. Google sí
ejecuta JS antes de indexar, así que para el buscador esto no es un
problema: cada página obtiene su propio título/descripción/canonical
correctamente vía `useSeo`. Si en algún momento se quiere que compartir
p.ej. `/contacto` en WhatsApp muestre su propia tarjeta (no la de la
Landing), haría falta prerender o un Edge Function de Vercel que inyecte
las etiquetas por ruta antes de servir el HTML — fuera del alcance de este
encargo.

### Páginas indexables vs. bloqueadas

Indexables (en `sitemap.xml`): `/`, `/upgrade`, `/contacto`, `/aviso-legal`,
`/privacidad`, `/terminos`, `/cookies`.

Bloqueadas en `robots.txt` (contenido privado/de usuario, sin valor de
búsqueda): `/home`, `/perfil`, `/progreso`, `/simulacro`, `/practicar/*`,
`/temas/*/resumen`, `/repasar-hoy`, `/admin/*`, `/newsletter/*` (estas
últimas también llevan `<meta name="robots" content="noindex">` vía
`useSeo({ noIndexar: true })`, por si alguna vez se enlazan desde fuera).
`/login`, `/registro` y `/onboarding` no están bloqueadas (son parte del
embudo público) pero tampoco están en el sitemap — no aportan como
resultado de búsqueda independiente.

## Registrar aprobox.es en Google Search Console

Esto requiere acceso del propietario del dominio/sitio — no se puede
automatizar desde aquí. Pasos, después de que el despliegue con este
encargo esté en producción:

1. Entra en [Google Search Console](https://search.google.com/search-console)
   con la cuenta de Google que quieras que administre la propiedad.
2. **Añadir propiedad** → elige **"Dominio"** (no "Prefijo de URL") e
   introduce `aprobox.es`. La verificación por dominio cubre `http`,
   `https`, `www` y sin `www` a la vez, y se hace por DNS — como ya
   gestionas el DNS de `aprobox.es` en el proveedor donde compraste el
   dominio, es la opción más simple:
   - Search Console te da un registro **TXT** (algo como
     `google-site-verification=xxxxxxxx`).
   - Añádelo como registro TXT en la zona DNS de `aprobox.es` (host/nombre:
     `@`, valor: el que te da Google).
   - Espera a que propague (minutos a pocas horas) y pulsa **Verificar**.
3. Una vez verificado, ve a **Sitemaps** (menú lateral) e introduce
   `sitemap.xml` (se completa solo con `https://aprobox.es/sitemap.xml`) →
   **Enviar**.
4. Opcional pero recomendado: en **Inspección de URLs**, pega
   `https://aprobox.es/` y pulsa **Solicitar indexación** para acelerar el
   primer rastreo en vez de esperar al rastreo espontáneo de Google.
5. Repite el registro en [Bing Webmaster Tools](https://www.bing.com/webmasters)
   si te interesa también aparecer en Bing — acepta importar directamente la
   propiedad ya verificada de Search Console con un par de clics, sin
   volver a verificar DNS.

No hace falta tocar código para nada de esto salvo que Google Search
Console ofrezca alternativamente el método de verificación por **archivo
HTML** o **etiqueta meta** en vez de DNS — en ese caso, el archivo iría en
`frontend/public/` (se sirve tal cual en la raíz) o la etiqueta meta en
`frontend/index.html`; pero con un dominio cuyo DNS ya gestionas, el
método TXT de arriba es más simple y no requiere un nuevo despliegue.
