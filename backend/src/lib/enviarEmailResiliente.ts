import { obtenerResend, RESEND_FROM_EMAIL } from "./resend";

interface EmailResiliente {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Envía un email sin dejar que un fallo (RESEND_API_KEY ausente en dev/test,
 * o un error real de Resend) tumbe la petición que lo dispara: quien llama
 * ya ha hecho lo importante (guardar el consentimiento, crear el usuario,
 * activar el premium...) antes de intentar avisar por email, así que un
 * envío fallido solo queda registrado en el log con la `etiqueta` de quien
 * llama, para poder investigarlo sin deshacer nada. Punto único para este
 * patrón — antes vivía copiado tres veces (routes/newsletter.ts y dos
 * funciones de lib/notificacionesAdmin.ts).
 */
export async function enviarEmailResiliente(etiqueta: string, params: EmailResiliente): Promise<void> {
  try {
    const { error } = await obtenerResend().emails.send({
      from: RESEND_FROM_EMAIL,
      to: params.to,
      subject: params.subject,
      text: params.text,
      ...(params.html ? { html: params.html } : {}),
    });
    if (error) console.error(`[${etiqueta}] Resend rechazó el envío a ${params.to}:`, error);
  } catch (err) {
    console.error(`[${etiqueta}] No se pudo enviar el email a ${params.to}:`, err);
  }
}
