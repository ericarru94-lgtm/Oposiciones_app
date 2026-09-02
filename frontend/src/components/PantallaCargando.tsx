import { useEffect, useState } from "react";

/** Cuánto esperar antes de asumir que la carga se ha quedado colgada. */
const SEGUNDOS_ANTES_DE_AVISAR = 8;

/**
 * Pantalla de "Cargando…" con salvavidas: si tras unos segundos sigue sin
 * resolverse (típicamente `useSession().cargando`, que en producción
 * depende de que Clerk termine de inicializarse), muestra un aviso
 * accionable en vez de dejar a quien visita la web mirando un spinner para
 * siempre. Un ClerkProvider que nunca resuelve `isLoaded` (dominio no
 * autorizado en el Dashboard de Clerk, DNS de un dominio personalizado de
 * Clerk sin propagar, publishableKey desincronizada...) deja precisamente
 * este síntoma — ver "Frontend colgado en 'Cargando…'" en backend/docs/clerk.md.
 */
export function PantallaCargando() {
  const [tardando, setTardando] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setTardando(true), SEGUNDOS_ANTES_DE_AVISAR * 1000);
    return () => clearTimeout(id);
  }, []);

  if (!tardando) {
    return <p className="mt-20 text-center text-muted">Cargando…</p>;
  }

  return (
    <div className="mx-auto mt-20 max-w-sm text-center">
      <p className="text-sm text-muted">Esto está tardando más de lo normal.</p>
      <p className="mt-2 text-sm text-muted">
        Puede ser un problema temporal de conexión. Prueba a recargar la página.
      </p>
      <button
        onClick={() => window.location.reload()}
        className="mt-4 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover"
      >
        Recargar
      </button>
    </div>
  );
}
