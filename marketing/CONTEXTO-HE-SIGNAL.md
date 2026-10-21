# Contexto de HE Signal (agencia) · Resumen para nuevos chats

Última actualización: 17/10/2026. Toda la conversación con el usuario es en **español**.

## La agencia
- **HE Signal**: agencia de Barcelona que monta **chatbots de WhatsApp e Instagram** para **academias (idiomas, repaso, oposiciones), autoescuelas y gimnasios** (boxes, pilates, boutique). También web con reserva integrada y marketing local. Trabaja en remoto para toda España.
- Web: https://www.hesignalagency.com (HTML estático en **Cloudflare Pages**, el usuario lo sube a mano). Código en `marketing/web/` de este repo. Página de reservar: `/agendar`; landing del nicho: `/boxes`.
- Instagram: **@hesignalagency** (conectado a **Metricool**, brandId/blogId `7236659`, plan gratuito: sin flujo de aprobación). También LinkedIn y WhatsApp Business.
- Oferta actual: **auditoría gratuita / sesión de 30 min** y **3 plazas piloto** con precio de lanzamiento y soporte prioritario el primer mes. Agencia joven y honesta: **nunca inventar clientes, cifras ni testimonios**.
- El dueño también tiene las apps **AproBox** (oposiciones; es este repositorio) y **Rumbea** (rutas en moto).

## Marca (obligatorio)
- **Naranja #FF4B2B** como color principal (oscuro #E23B1C, claro #FF8A70), fondo **azul marino #10151F**, papel #F1F3EE. El verde #12B76A solo para el punto de «en línea».
- Tipografías: **Space Grotesk** (títulos) e **Inter** (texto). Se descargan de github.com/google/fonts (ver `marketing/instagram/plantilla/README.md`).
- **Logo nuevo**: monograma «HE» de trazo fino estilo circuito, con terminales circulares y un punto naranja con ondas de señal. Eslogan: **«IA · CHATBOTS · MARKETING»**. Archivos en `marketing/marca/logo-final/` (Instagram, WhatsApp, LinkedIn, web, SVG). Ya está puesto en la web, Instagram, LinkedIn y WhatsApp. El eslogan está en el pie de la web desde la versión 22.

## Herramientas y cómo se ha trabajado
- **Canva**: se usó, pero su cuota de generación se agota rápido y metía errores. El usuario eligió seguir con **la plantilla propia** (Playwright + ffmpeg): `marketing/instagram/plantilla/` (`render.js` para reels 1080×1920, `mux.py` añade música suave + «pops», `carrusel.js` para carruseles 1080×1350).
- **Publicación**: los medios se suben a la rama `ccr-a8d5acd9-xw9soj` de este repo público y se pasan a Metricool como URL de `raw.githubusercontent.com` (Metricool guarda su copia).
- Vídeo con IA real (Figma Weave / Veo) requiere que el usuario vincule Figma con Weave (pendiente).
- Render (MCP) está configurado pero bloqueado por la red del entorno.

## Resultados semana 1 (7–13 oct)
- 5 publicaciones (3 reels sin audio a las 08:30 y 19:00, 2 carruseles). **0 seguidores, 0 comentarios, 0 mensajes.**
- Solo funcionó el reel de «historia con coste» publicado **domingo 19:00** («…ya se había apuntado en otro gimnasio»): **110 reproducciones**. El resto 1–3.
- Conclusión: cuenta nueva sin alcance; los carruseles no llegan a no seguidores; hay que publicar **reels con audio, por la tarde, estilo escena/historia** y, sobre todo, **contacto directo** con centros.

## Semana 2 (en curso, 14–18 oct)
- **Contacto directo (prioridad)**: `marketing/prospeccion/prospeccion-centros-barcelona.xlsx` (30 centros independientes de Barcelona con IG/WhatsApp/teléfono) y `marketing/prospeccion/GUIONES-CONTACTO.md`. Método «cliente misterioso»: el usuario escribe de noche (21:30–23:00) desde su móvil personal, anota tiempo de respuesta y luego manda un DM personalizado con el resultado. **LSSI**: nada de mensajes comerciales masivos por WhatsApp/email; solo DM de Instagram, llamada o en persona, uno a uno. El usuario empezó las pruebas el 13/10 por la noche.
- **Reels programados en Metricool como TRIAL_REEL** (con audio): mié 14 19:30 (autoescuela), vie 16 19:30 (academia, mensajes del finde), dom 18 19:00 («haz esta prueba esta noche»). Archivos en `marketing/instagram/semana-2/`.
- Promoción pagada (opción C): aparcada por ahora. Idea: promocionar el reel de 110 reproducciones con 20–30 €, Barcelona, dueños de gimnasios/academias.

## Auditoría de captación y campaña «Boxes antes de enero» (17/10)
- Informe completo: `marketing/campana-boxes/INFORME.md`; guion comercial, demo y seguimiento: `GUION-COMERCIAL.md`; 5 piezas listas: `PIEZAS.md` + `piezas/`.
- Hallazgos clave: los reels del 14 y 16/10 **no se publicaron** (Metricool: TRIAL_REEL exige un mínimo de seguidores; publicar siempre como REEL normal). Los 4 envíos del formulario (incluido «Hugo Palacios» del 7/9) fueron pruebas del usuario: la web no ha traído ningún contacto real. «Agendar» era un formulario sin teléfono que prometía respuesta en 24 h.
- Nicho elegido para 30 días: **boxes de CrossFit / gimnasios de clases dirigidas de Barcelona**. Palabra clave: PRUEBA.
- Oferta de entrada **aprobada**: piloto 30 días para boxes, 0 € alta + 149 € + IVA, devolución si no reserva ninguna clase de prueba; después alta 295 € + 89 €/mes. Solo 3 plazas.
- **Web (v30, 21/10)**: base = la v29 que hizo el usuario en otro chat (quitó /boxes → redirige a /demo, quitó el piloto de 149 €, la demo invita a agendar con precios normales, añadió /propuesta noindex, arregló el z-index del menú) + títulos SEO nuevos. **Antes de tocar la web, pedir al usuario su último zip**: puede haber cambios de otros chats.
- **Web**: el código ya está en el repo, `marketing/web/` (versión 22 con /boxes, /agendar con WhatsApp, botón flotante, coherencia). El usuario la sube a mano a Cloudflare Pages. Calendario de reservas (Google Calendar, «Sesión gratuita HE Signal», 30 min, Meet): https://calendar.app.google/phDrTJWAyQGDPsba6, enlazado en /agendar, /boxes y /gracias desde la versión 25.
- **Demo en la web (versión 26)**: `/demo` con «Box Norte» (box ficticio, mismo que los reels). **Solo respuestas preparadas, gratis** (`assets/demo.js`): el usuario descartó la IA de pago (no quiere pagar por conversación sin cliente asegurado). Mensajes cortos en varias burbujas, máximo un emoji cada dos respuestas (lo controla `pulir()`), reserva de clase de prueba conversando, lesiones pasadas al coach, castellano y catalán, «¿hay clase hoy?» con la hora real, y panel del dueño al lado. Desde la v26 tiene una **ficha del box** (`KB` en demo.js: actividades, Hyrox, halterofilia, open box, movilidad, pagos, descuentos, coaches, app, edad, festivos, nutrición, fisio, competiciones…) con búsqueda tolerante a faltas; si no entiende, la primera vez pasa a Marc y la segunda ofrece temas. Enlazada en el menú, la portada y /boxes. Las demos de Vallès Jiu Jitsu y Forja Fit son artefactos de Claude (la de Vallès usa la IA de la cuenta de Claude y no funciona en una web pública).
- **Metricool (programado 17/10, todo como REEL)**: dom 18 19:00 pieza 1 · lun 19 19:30 «haz esta prueba» · mar 20 19:30 pieza 2 · mié 21 19:30 autoescuela · jue 22 19:30 pieza 3 · vie 23 19:30 academia · sáb 24 11:00 carrusel pieza 4.
- La hoja de prospección tiene ya las columnas del experimento (S variante A/B, T motivo de pérdida).

## Próximos pasos previstos
- Lunes 19/10: el usuario pasa la hoja rellenada y las reproducciones de los 3 reels → auditoría (`/ig-audit`) y plan de semana 3.
- Redactar los DMs personalizados con los resultados de cada prueba.
- Proyectos que el usuario quiere hacer en otro chat: **chatbot de muestra** (demo para enseñar a clientes) y **reel para anuncio pagado en Instagram**.

## Mapa de archivos (`marketing/`)
- `instagram/semana-1/` · reels, carruseles, textos, `GUIA.md` (perfil, historias, DMs, respuestas), `historias/`
- `instagram/semana-2/` · 3 reels con audio
- `instagram/plantilla/` · generador de reels y carruseles
- `marca/logo-final/` · logo definitivo en todos los formatos · `marca/kit-web-hesignal.zip`
- `prospeccion/` · lista de centros y guiones de contacto
- Skills de Instagram instaladas en `.claude/skills/ig-*` (ig-reel, ig-caption, ig-plan, ig-audit, ig-dm…)

## Preferencias del usuario
- Quiere que Claude **haga y ejecute** (no solo aconseje), pero con honestidad sobre resultados.
- Usa sobre todo el **móvil**; explicaciones paso a paso y cortas.
- Fusionar PRs cuando lo pide.
