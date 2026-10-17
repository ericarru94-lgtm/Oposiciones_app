# Contexto de HE Signal (agencia) · Resumen para nuevos chats

Última actualización: 17/10/2026. Toda la conversación con el usuario es en **español**.

## La agencia
- **HE Signal**: agencia de Barcelona que monta **chatbots de WhatsApp e Instagram** para **academias (idiomas, repaso, oposiciones), autoescuelas y gimnasios** (boxes, pilates, boutique). También web con reserva integrada y marketing local. Trabaja en remoto para toda España.
- Web: https://www.hesignalagency.com (HTML estático en **Cloudflare Pages**, el usuario lo sube a mano; no está en GitHub). Página de reservar: `/agendar`.
- Instagram: **@hesignalagency** (conectado a **Metricool**, brandId/blogId `7236659`, plan gratuito: sin flujo de aprobación). También LinkedIn y WhatsApp Business.
- Oferta actual: **auditoría gratuita / sesión de 30 min** y **3 plazas piloto** con precio de lanzamiento y soporte prioritario el primer mes. Agencia joven y honesta: **nunca inventar clientes, cifras ni testimonios**.
- El dueño también tiene las apps **AproBox** (oposiciones; es este repositorio) y **Rumbea** (rutas en moto).

## Marca (obligatorio)
- **Naranja #FF4B2B** como color principal (oscuro #E23B1C, claro #FF8A70), fondo **azul marino #10151F**, papel #F1F3EE. El verde #12B76A solo para el punto de «en línea».
- Tipografías: **Space Grotesk** (títulos) e **Inter** (texto). Se descargan de github.com/google/fonts (ver `marketing/instagram/plantilla/README.md`).
- **Logo nuevo**: monograma «HE» de trazo fino estilo circuito, con terminales circulares y un punto naranja con ondas de señal. Eslogan: **«IA · CHATBOTS · MARKETING»**. Archivos en `marketing/marca/logo-final/` (Instagram, WhatsApp, LinkedIn, web, SVG). Ya está puesto en la web, Instagram, LinkedIn y WhatsApp. El eslogan aún no está en la web (falta que el usuario mande la carpeta de la web en .zip).

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
- Hallazgos clave: los reels del 14 y 16/10 **no se publicaron** (Metricool: TRIAL_REEL exige un mínimo de seguidores; publicar siempre como REEL normal). Lead del formulario del 7/9 («Hugo Palacios», gimnasio) sin respuesta en el Gmail. «Agendar» es un formulario sin teléfono que promete respuesta en 24 h.
- Nicho elegido para 30 días: **boxes de CrossFit / gimnasios de clases dirigidas de Barcelona**. Palabra clave: PRUEBA.
- Oferta de entrada propuesta (pendiente de aprobar por el usuario): piloto 30 días, 0 € alta + 149 € + IVA, devolución si no reserva ninguna clase de prueba.
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
