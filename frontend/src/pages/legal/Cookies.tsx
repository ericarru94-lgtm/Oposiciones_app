import { PaginaEstatica } from "../../components/PaginaEstatica";

export function Cookies() {
  return (
    <PaginaEstatica icono="🍪" titulo="Política de cookies">
      <p className="text-xs text-muted">
        Última actualización: agosto de 2026. Este documento es una plantilla de partida — revísala con
        asesoramiento legal antes de considerarla definitiva.
      </p>

      <h2 className="text-base font-semibold text-ink">1. Qué son las cookies</h2>
      <p>
        Las cookies son pequeños archivos que se guardan en tu navegador y permiten, entre otras cosas, mantener tu
        sesión iniciada o recordar tus preferencias.
      </p>

      <h2 className="text-base font-semibold text-ink">2. Qué cookies usa Aprobox</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <strong>Cookies técnicas de autenticación (Clerk):</strong> necesarias para mantener tu sesión iniciada y
          proteger las rutas privadas de la aplicación. No se pueden desactivar sin perder la capacidad de iniciar
          sesión.
        </li>
        <li>
          <strong>Cookies analíticas:</strong> actualmente Aprobox no usa cookies analíticas de terceros. Si en el
          futuro se añaden (p. ej. para medir uso agregado del Servicio), esta política se actualizará antes de
          activarlas.
        </li>
      </ul>

      <h2 className="text-base font-semibold text-ink">3. Cómo gestionar las cookies</h2>
      <p>
        Puedes eliminar o bloquear las cookies desde la configuración de tu navegador. Ten en cuenta que bloquear
        las cookies de autenticación te impedirá mantener la sesión iniciada en Aprobox.
      </p>

      <h2 className="text-base font-semibold text-ink">4. Actualizaciones de esta política</h2>
      <p>
        Revisaremos esta política si cambian las cookies que usamos. Consulta esta página periódicamente para estar
        al tanto de cualquier cambio.
      </p>
    </PaginaEstatica>
  );
}
