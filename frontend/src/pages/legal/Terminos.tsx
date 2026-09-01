import { PaginaEstatica } from "../../components/PaginaEstatica";

export function Terminos() {
  return (
    <PaginaEstatica icono="📄" titulo="Términos y condiciones">
      <p className="text-xs text-muted">
        Última actualización: agosto de 2026. Este documento es una plantilla de partida — revísala con
        asesoramiento legal antes de considerarla definitiva.
      </p>

      <h2 className="text-base font-semibold text-ink">1. Objeto</h2>
      <p>
        Estas condiciones regulan el uso de Aprobox, una plataforma de preparación para la oposición de Auxiliar
        Administrativo del Estado mediante banco de preguntas verificadas, tests por tema y simulacros de examen.
      </p>

      <h2 className="text-base font-semibold text-ink">2. Descripción del servicio</h2>
      <p>
        Aprobox ofrece un mini-test de prueba sin registro, y tras crear una cuenta gratuita: seguimiento de
        progreso, repaso por repetición espaciada con un límite diario de preguntas, y simulacros de examen
        configurables.
      </p>

      <h2 className="text-base font-semibold text-ink">3. Plan premium</h2>
      <p>
        El plan premium cuesta <strong>4,99€/mes</strong> e incluye preguntas ilimitadas y repaso sin las
        restricciones del límite diario del plan gratuito. La suscripción se factura de forma recurrente mensual a
        través de Stripe.
      </p>

      <h2 className="text-base font-semibold text-ink">4. Cancelación</h2>
      <p>
        Puedes cancelar tu suscripción en cualquier momento desde tu Perfil ("Gestionar suscripción"). Al cancelar,
        mantienes el acceso premium hasta el final del periodo ya pagado; no se aplican reembolsos por el tiempo
        restante del periodo en curso salvo que la ley aplicable exija lo contrario.
      </p>

      <h2 className="text-base font-semibold text-ink">5. Limitación de responsabilidad sobre el contenido</h2>
      <p>
        Las preguntas del banco tienen carácter <strong>orientativo</strong> y de apoyo al estudio. Aunque se
        revisan y se citan con su fuente legal cuando es posible, no sustituyen al temario oficial de la
        convocatoria ni constituyen asesoramiento jurídico. Aprobox no garantiza la aprobación del proceso selectivo
        ni la ausencia total de erratas; si detectas un error, puedes reportarlo desde{" "}
        <a href="/contacto" className="text-primary hover:underline">
          Contacto
        </a>
        .
      </p>

      <h2 className="text-base font-semibold text-ink">6. Propiedad intelectual</h2>
      <p>
        El software, el diseño y la marca Aprobox son propiedad de su titular, Eric Arrufat Marín. El contenido
        derivado de exámenes oficiales se usa con fines educativos, citando su fuente cuando corresponde.
      </p>

      <h2 className="text-base font-semibold text-ink">7. Modificación de las condiciones</h2>
      <p>
        Podemos actualizar estas condiciones para reflejar cambios en el Servicio o en la normativa aplicable. Los
        cambios sustanciales se comunicarán a los usuarios registrados con antelación razonable.
      </p>

      <h2 className="text-base font-semibold text-ink">8. Legislación aplicable</h2>
      <p>Estas condiciones se rigen por la legislación española.</p>
    </PaginaEstatica>
  );
}
