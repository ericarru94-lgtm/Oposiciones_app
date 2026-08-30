/**
 * Plantillas de email de la newsletter: HTML simple con estilos inline
 * (Resend no necesita ni recomienda una librería de templating para esto)
 * en la misma paleta que el resto de la app (índigo/ámbar, ver
 * frontend/src/index.css). Cada email incluye el enlace de baja en el
 * pie — obligatorio en cualquier comunicación comercial/informativa por
 * suscripción según RGPD/LSSI-CE, así que vive en el envoltorio común
 * (`envoltorio`) para que sea imposible enviar un email de newsletter sin
 * él.
 */

const COLOR_PRIMARIO = "#4338ca";
const COLOR_ACENTO = "#f59e0b";
const COLOR_TINTA = "#1e1b2e";
const COLOR_MUTED = "#6b7280";
const COLOR_LINEA = "#e5e7eb";
const COLOR_LIENZO = "#eef2ff";

function envoltorio(cuerpoHtml: string, bajaUrl: string): string {
  return `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:0;background:${COLOR_LIENZO};font-family:Arial,Helvetica,sans-serif;">
    <div style="max-width:480px;margin:0 auto;padding:32px 16px;">
      <div style="background:#ffffff;border-radius:16px;overflow:hidden;">
        <div style="background:${COLOR_PRIMARIO};padding:24px 32px;">
          <span style="color:#ffffff;font-size:18px;font-weight:700;">Aprobox</span>
        </div>
        <div style="padding:32px;color:${COLOR_TINTA};font-size:14px;line-height:1.6;">
          ${cuerpoHtml}
        </div>
        <div style="padding:20px 32px;border-top:1px solid ${COLOR_LINEA};color:${COLOR_MUTED};font-size:12px;line-height:1.5;">
          <p style="margin:0 0 6px;">Recibes este email porque te suscribiste a la newsletter de Aprobox.</p>
          <p style="margin:0;"><a href="${bajaUrl}" style="color:${COLOR_MUTED};">Darme de baja</a></p>
        </div>
      </div>
    </div>
  </body>
</html>`;
}

function boton(texto: string, url: string, color: string): string {
  return `<p style="text-align:center;margin:32px 0;">
    <a href="${url}" style="background:${color};color:#ffffff;padding:12px 28px;border-radius:9999px;text-decoration:none;font-weight:700;font-size:14px;display:inline-block;">${texto}</a>
  </p>`;
}

export function plantillaConfirmacion(params: { confirmarUrl: string; bajaUrl: string }) {
  const { confirmarUrl, bajaUrl } = params;
  const html = envoltorio(
    `<h1 style="font-size:20px;margin:0 0 16px;">Confirma tu suscripción</h1>
    <p style="margin:0 0 8px;">Gracias por suscribirte a las novedades de Aprobox. Confirma tu email para empezar a recibir recordatorios de racha y contenido nuevo del banco de preguntas.</p>
    ${boton("Confirmar mi suscripción", confirmarUrl, COLOR_ACENTO)}
    <p style="color:${COLOR_MUTED};font-size:12px;margin:0;">Si no has solicitado esto, puedes ignorar este email — no se creará ninguna suscripción sin confirmar.</p>`,
    bajaUrl
  );
  const text = `Confirma tu suscripción a la newsletter de Aprobox entrando en este enlace:\n${confirmarUrl}\n\nSi no has solicitado esto, puedes ignorar este email.\n\nDarme de baja: ${bajaUrl}`;
  return { subject: "Confirma tu suscripción a Aprobox", html, text };
}

export function plantillaBienvenida(params: { frontendUrl: string; bajaUrl: string }) {
  const { frontendUrl, bajaUrl } = params;
  const html = envoltorio(
    `<h1 style="font-size:20px;margin:0 0 16px;">¡Suscripción confirmada! 🎉</h1>
    <p style="margin:0 0 8px;">Ya formas parte de la newsletter de Aprobox. Te avisaremos con recordatorios de racha, novedades y contenido nuevo del banco de preguntas.</p>
    <p style="margin:0;">Mientras tanto, ¿qué tal si practicas un poco?</p>
    ${boton("Ir a Aprobox", frontendUrl, COLOR_PRIMARIO)}`,
    bajaUrl
  );
  const text = `Tu suscripción a la newsletter de Aprobox está confirmada.\n\nPractica en: ${frontendUrl}\n\nDarme de baja: ${bajaUrl}`;
  return { subject: "¡Bienvenido a la newsletter de Aprobox!", html, text };
}
