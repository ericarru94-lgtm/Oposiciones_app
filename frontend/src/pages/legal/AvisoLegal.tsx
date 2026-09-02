import { PaginaEstatica } from "../../components/PaginaEstatica";

export function AvisoLegal() {
  return (
    <PaginaEstatica
      icono="⚖️"
      titulo="Aviso legal"
      ruta="/aviso-legal"
      descripcion="Aviso legal de Aprobox: identificación del titular, condiciones de acceso y propiedad intelectual de la plataforma de preparación de la oposición de Auxiliar Administrativo del Estado."
    >
      <p className="text-xs text-muted">
        Última actualización: agosto de 2026. Este documento es una plantilla de partida — revísala con
        asesoramiento legal antes de considerarla definitiva.
      </p>

      <h2 className="text-base font-semibold text-ink">1. Identificación del titular</h2>
      <p>
        Aprobox es un proyecto operado por <strong>Eric Arrufat Marín</strong>, con NIF <strong>47928717M</strong>,
        actuando como particular. Contacto:{" "}
        <a href="mailto:aprobox.app@gmail.com" className="text-primary hover:underline">
          aprobox.app@gmail.com
        </a>{" "}
        · 623 976 145.
      </p>

      <h2 className="text-base font-semibold text-ink">2. Objeto y ámbito de aplicación</h2>
      <p>
        Este aviso legal regula el acceso y uso del sitio web y la aplicación Aprobox (el "Servicio"), una
        plataforma de preparación para la oposición de Auxiliar Administrativo del Estado mediante banco de
        preguntas, tests y simulacros de examen.
      </p>

      <h2 className="text-base font-semibold text-ink">3. Condiciones de acceso y uso</h2>
      <p>
        El acceso a determinadas funcionalidades requiere el registro de una cuenta. El usuario se compromete a
        hacer un uso lícito del Servicio, a no suplantar la identidad de terceros y a proporcionar datos veraces en
        el registro.
      </p>

      <h2 className="text-base font-semibold text-ink">4. Propiedad intelectual</h2>
      <p>
        El diseño, el software y los contenidos propios de Aprobox (textos, estructura del banco de preguntas,
        marca) son propiedad de su titular o se usan bajo licencia. Las preguntas basadas en exámenes oficiales se
        citan con su fuente cuando procede.
      </p>

      <h2 className="text-base font-semibold text-ink">5. Exclusión de responsabilidad</h2>
      <p>
        El contenido de Aprobox tiene carácter orientativo y de apoyo al estudio; no sustituye al temario oficial de
        la convocatoria ni garantiza resultado alguno en el proceso selectivo. Ver también la sección de limitación
        de responsabilidad en los{" "}
        <a href="/terminos" className="text-primary hover:underline">
          Términos y condiciones
        </a>
        .
      </p>

      <h2 className="text-base font-semibold text-ink">6. Legislación aplicable y jurisdicción</h2>
      <p>
        Este aviso legal se rige por la legislación española. Para cualquier controversia, las partes se someten a
        los juzgados y tribunales que resulten competentes conforme a la normativa de protección de consumidores y
        usuarios aplicable.
      </p>
    </PaginaEstatica>
  );
}
