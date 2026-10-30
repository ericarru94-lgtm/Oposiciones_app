# Mapa de proyectos del usuario · Resumen de todos los chats

Última actualización: 30/10/2026. Hecho a partir del último resumen de cada chat y de la documentación de cada repositorio. Para el detalle técnico, abre el chat o el repositorio correspondiente. Todo en **español**.

Cuentas: email personal `eric.arru94@gmail.com`; la agencia usa `hesignalagency@gmail.com` (es el Gmail conectado en algunos chats). GitHub `ericarru94-lgtm`, Vercel (cuenta personal, sin equipos).

---

## 1. HE Signal · agencia de chatbots (chat «Conexion Herramientas»)
Agencia de Barcelona: chatbots de WhatsApp e Instagram para academias, autoescuelas y gimnasios. Web estática en Cloudflare Pages (hesignalagency.com), Instagram @hesignalagency (Metricool).
**Todo el detalle en [`marketing/CONTEXTO-HE-SIGNAL.md`](marketing/CONTEXTO-HE-SIGNAL.md)**: marca (naranja #FF4B2B, logo de circuito «HE», eslogan «IA · CHATBOTS · MARKETING»), resultados, plan de la semana 2 (contacto directo con 30 centros + 3 reels de prueba) y archivos.
Próximo: chatbot de muestra para enseñar a clientes y reel para anuncio pagado en Instagram.

## 2. AproBox · app de oposiciones (este repositorio · chats «Aprobox» y «Rumbea»)
- **Qué es**: preparación de oposiciones de Auxiliar Administrativo del Estado. Banco de 414 preguntas (28 temas), mini-test sin registro, repetición espaciada (SM-2), progreso y racha. Plan Gratis + **Premium 4,99 €/mes** (Stripe, modo test). Login con **Clerk**. Web: **aprobox.es**.
- **Código**: `backend/` (API REST + Prisma/PostgreSQL) y `frontend/` (React + Vite + Tailwind). Rama principal: `claude/oposiciones-prep-app-skeleton-eht1h6`. Despliegue en Render. Ver `README.md` y `backend/docs/`.
- **Estado (13/10)**:
  - Auditoría de rendimiento hecha en el chat «Aprobox»: bug de re-render de SessionContext arreglado, caché en el backend, 233 tests en verde.
  - **Bug de registro resuelto**: la protección anti-bot «legacy» de Clerk (Bot sign-up protection / Turnstile) bloqueaba el registro en Aprobox y Rumbea. Se desactivó y el registro ya funciona de principio a fin (comprobado con código de verificación).
  - Google Ads: unos 662 clics de pago (294 Aprobox + 368 Rumbea) llegaron cuando el registro fallaba. Las campañas se pausaron. El usuario va a **probar a reactivar solo Aprobox durante una semana**; si no hay registros, la vuelve a pausar.
  - Auditoría web: todo funciona (portada, temario, blog con 4 artículos, onboarding, login/registro, robots.txt, sitemap con 13 URLs, metadatos SEO). **Aún no aparece en Google** (dominio de unas 4–6 semanas). Recomendado: verificar **Google Search Console** y enviar el sitemap.

## 3. Rumbea · app de rutas en moto (chat «Rumbea»)
- Repositorio privado `ericarru94-lgtm/Rumbea`; proyecto de Vercel `rumbea-web`.
- Afectada por el mismo bug de Clerk (ya resuelto). Campañas de Google Ads pausadas.
- Documentos creados en ese chat (artefactos): «Auditoría Rumbea», «Anuncios Rumbea» y «Rumbea × Influencers».

## 4. FaroPyme · web de IA y software para pymes (chat «IA + Software»; antes «Fase 1 web», archivado)
- Repositorio `ericarru94-lgtm/ia-para-empresas` → **faropyme.es** (nombre provisional anterior: «Núcleo»). Web SEO en español: IA para empresas, software, automatización, CRM, comparativas, guías y calculadoras. Next.js 16 + Tailwind v4, en Vercel (proyecto `ia-para-empresas`).
- Reglas del proyecto en su `AGENTS.md`: nada de datos inventados, contenido en borrador hasta que esté completo, cumplimiento legal (LSSI/RGPD, cookies) y **declarar el conflicto de interés con HE Signal** cuando se enlacen sus servicios.
- **Estado (13/10)**: rama `fase-8` subida a GitHub (commit 268a05c) **sin fusionar a `main`**. `npm run check` y todos los tests e2e en verde (57 unit, 120 prod, 107 QA). La web está en **pre-lanzamiento** (`SITE_LAUNCHED` sin activar, noindex).

## 5. HE SIGNAL AI OFFICE · oficina virtual de agentes de IA (chat «AI Office»)
- Carpeta `office/` de este repositorio (app independiente: Next.js 16 + Supabase + Claude). Rama `ccr-30b91845-834xuv`.
- Nueve empleados de IA (Alex CEO, Marcus, Sofia, Daniel, Lucia, David, Emma, Oscar, Victoria) con permisos: toda acción externa, gasto, producción o borrado requiere aprobación del administrador.
- **Estado (30/10)**: fase 1 terminada (30 pruebas). Uso personal y gratuito. Supabase creado: proyecto `he-signal-office` (`bgptbtmyhtobqohkoeyd`, plan Free, Irlanda) con migraciones y seed; admin permitido `hesignalagency@gmail.com`. Cuenta de administrador creada y vinculada (30/10). Publicada en **https://he-signal-office.vercel.app** (Vercel Hobby, proyecto `he-signal-office`, Root Directory `office`, producción desplegada desde la rama `ccr-30b91845-834xuv` con la herramienta de Vercel). Auditoría de la fase 1 hecha tras la revisión de ChatGPT (`office/docs/AUDITORIA-FASE-1.md`): aprobaciones con huella y un solo uso, motor con leases, agent_runs, documentos, memoria versionada, costes; 74 pruebas. Migración 0004 aplicada en Supabase el 30/10 (en dos partes, sin operaciones destructivas) y verificada; nueva versión publicada en Vercel. Diseño 3D listo en `office/docs/FASE-2-DISENO-3D.md`. Auditoría final (`office/docs/AUDITORIA-FINAL.md`): veredicto APTO CON CONDICIONES; migración `0005` (mínimo privilegio, idempotencia `tool_executions`, alta de admin con email confirmado) **aplicada y verificada** el 30/10; cliente real de Claude preparado; plan del piloto Alex/Marcus/Sofia en `office/docs/FASE-3-PILOTO.md` Claves `ANTHROPIC_API_KEY` y `SUPABASE_SECRET_KEY` puestas en Vercel (Sensitive, producción) y web republicada (commit 53ca188). Límites: consola de Anthropic 15 $/mes con 15 $ de crédito; oficina 10 $/mes y 1 $/tarea. Inicio de sesión real comprobado (registro de actividad). Fase 2 autorizada (piloto real Alex Sonnet 5.5 medio, Marcus Sonnet 5.5 alto, Sofia Haiku 5.5 alto; sin respaldo automático de modelo). Ejecutor real, herramientas, pantallas de encargos y migración `0006_pilot_engine.sql` hechos y probados en local (106 pruebas, build OK) y subidos a la rama. **Pendiente de autorización del usuario: aplicar 0006 en Supabase y publicar en Vercel**; después, diagnóstico de modelos y primera misión real (gimnasios de Barcelona). Luego: oficina 3D, Realtime y revisión final.

---

### Cómo usar este archivo en un chat nuevo
Abre el chat con el repositorio **Oposiciones_app** y di: «Lee CONTEXTO-PROYECTOS.md y marketing/CONTEXTO-HE-SIGNAL.md». Para trabajar en FaroPyme o Rumbea, añade además su repositorio al chat.
