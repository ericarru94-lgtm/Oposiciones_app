import { useEffect, useState } from "react";

/**
 * Hook genérico para el patrón "pedir datos al backend al montar, con
 * cancelación si el componente se desmonta antes de terminar" — antes
 * reimplementado a mano (useState + useEffect + flag `cancelado`) en cada
 * página que lo necesitaba: Home, Progreso, Perfil, Temario.
 *
 * `cargar` se vuelve a ejecutar cuando cambia alguna entrada de `deps`,
 * igual que el array de dependencias de useEffect. Si `cargar` resuelve a
 * `undefined` (p.ej. porque `getToken()` no dio token todavía), `datos` se
 * queda en `null` sin marcar error.
 *
 * No se ha aplicado a ResumenTema.tsx a propósito: esa página depende del
 * param de ruta `temaId`, que puede cambiar con el componente ya montado
 * (navegar de un tema a otro), y mantiene a propósito el contenido anterior
 * en pantalla mientras llega el nuevo en vez de mostrar "Cargando…" de
 * golpe — este hook sí resetea a `cargando` en cada cambio de `deps`, un
 * comportamiento distinto que no quería forzar sin poder verlo en el
 * navegador.
 */
export function useApiData<T>(
  cargar: () => Promise<T | undefined>,
  deps: unknown[]
): { datos: T | null; cargando: boolean; error: unknown } {
  const [datos, setDatos] = useState<T | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let cancelado = false;
    setCargando(true);
    setError(null);
    (async () => {
      try {
        const resultado = await cargar();
        if (cancelado) return;
        setDatos(resultado ?? null);
      } catch (err) {
        if (cancelado) return;
        console.error("[useApiData] Error al cargar datos:", err);
        setError(err);
      } finally {
        if (!cancelado) setCargando(false);
      }
    })();
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { datos, cargando, error };
}
