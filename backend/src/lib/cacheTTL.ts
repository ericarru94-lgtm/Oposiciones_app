/**
 * Caché en memoria de un único valor con expiración, para endpoints públicos
 * de lectura muy frecuente y muy poco cambiantes (p.ej. /preguntas/temas).
 * No es apta para datos que deban verse al instante tras escribirse, ni es
 * compartida entre procesos (cada instancia de Render tiene la suya, lo cual
 * es aceptable aquí porque el dato es casi estático).
 */
export function crearCacheTTL<T>(cargar: () => Promise<T>, ttlMs: number): () => Promise<T> {
  let valor: T | undefined;
  let expiraEn = 0;

  return async () => {
    const ahora = Date.now();
    if (valor !== undefined && ahora < expiraEn) return valor;
    valor = await cargar();
    expiraEn = ahora + ttlMs;
    return valor;
  };
}
