import { PaginaEstatica } from "../../components/PaginaEstatica";

export function Privacidad() {
  return (
    <PaginaEstatica icono="🔒" titulo="Política de privacidad">
      <p className="text-xs text-muted">
        Última actualización: agosto de 2026. Este documento es una plantilla de partida — revísala con
        asesoramiento legal antes de considerarla definitiva.
      </p>

      <h2 className="text-base font-semibold text-ink">1. Responsable del tratamiento</h2>
      <p>
        <strong>[Nombre y apellidos / razón social del titular]</strong>, contacto:{" "}
        <a href="mailto:aprobox@gmail.com" className="text-primary hover:underline">
          aprobox@gmail.com
        </a>
        .
      </p>

      <h2 className="text-base font-semibold text-ink">2. Qué datos recogemos</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>Datos de cuenta: email (y nombre, si lo facilitas al registrarte).</li>
        <li>Datos de progreso de estudio: respuestas a preguntas, aciertos/fallos, racha y estadísticas de uso.</li>
        <li>
          Datos de pago: los gestiona íntegramente Stripe como pasarela de pago; Aprobox nunca almacena el número de
          tu tarjeta.
        </li>
      </ul>

      <h2 className="text-base font-semibold text-ink">3. Finalidad del tratamiento</h2>
      <p>
        Prestar el Servicio (guardar tu progreso, calcular tu repaso por repetición espaciada), gestionar tu cuenta
        y, si te suscribes al plan premium, procesar el cobro recurrente y darte acceso a las funciones sin límites.
      </p>

      <h2 className="text-base font-semibold text-ink">4. Base legal</h2>
      <p>
        Ejecución del contrato de prestación del Servicio (art. 6.1.b RGPD) para los datos de cuenta y progreso, y
        para el cobro de la suscripción si te haces premium. El registro es voluntario: no tratamos tus datos con
        una base legal distinta a la necesaria para ofrecerte el Servicio que solicitas.
      </p>

      <h2 className="text-base font-semibold text-ink">5. Conservación de los datos</h2>
      <p>
        Conservamos tus datos mientras mantengas la cuenta activa. Si la das de baja, se conservan solo durante el
        plazo legalmente exigible (p. ej. obligaciones fiscales derivadas de un pago) y después se suprimen o
        anonimizan.
      </p>

      <h2 className="text-base font-semibold text-ink">6. Con quién compartimos tus datos</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <strong>Clerk</strong>, como proveedor de autenticación (gestiona el registro/login y la sesión).
        </li>
        <li>
          <strong>Stripe</strong>, como pasarela de pago, si te suscribes al plan premium.
        </li>
      </ul>
      <p>Ambos actúan como encargados del tratamiento y no usan tus datos para fines propios ajenos al Servicio.</p>

      <h2 className="text-base font-semibold text-ink">7. Tus derechos</h2>
      <p>
        Puedes ejercer tus derechos de acceso, rectificación, supresión, oposición, limitación del tratamiento y
        portabilidad escribiendo a{" "}
        <a href="mailto:aprobox@gmail.com" className="text-primary hover:underline">
          aprobox@gmail.com
        </a>
        . También puedes eliminar preguntas respondidas o tu cuenta directamente desde la app cuando esa
        funcionalidad esté disponible, o solicitándolo por email.
      </p>
    </PaginaEstatica>
  );
}
