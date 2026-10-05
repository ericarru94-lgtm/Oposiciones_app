/**
 * Aplica `tarea` a cada elemento de `items`, con como mucho `limite`
 * ejecuciones en vuelo a la vez — ni secuencial (una `await` tras otra,
 * que con miles de elementos multiplica el tiempo total por el tamaño del
 * lote) ni sin ningún límite (lanzar todo a la vez con un único
 * `Promise.all(items.map(tarea))`, que puede agotar sockets o memoria del
 * proceso, o saturar al servicio externo al otro lado).
 *
 * Pensada para lotes de llamadas de red a un servicio externo — p.ej.
 * enviar notificaciones push a miles de suscripciones (ver
 * lib/enviarRecordatorios.ts): secuencial, 10.000 suscripciones a ~200ms
 * cada una tardarían más de media hora; en paralelo con límite, segundos.
 *
 * Un fallo de `tarea` en un elemento no interrumpe el resto: se recoge
 * como `{ ok: false, error }` en la posición correspondiente, en el mismo
 * orden que `items`, en vez de rechazar toda la operación (a diferencia de
 * `Promise.all`, donde un único rechazo descarta el resultado de todo lo
 * demás).
 */
export async function ejecutarConLimite<T, R>(
  items: readonly T[],
  limite: number,
  tarea: (item: T, indice: number) => Promise<R>
): Promise<({ ok: true; valor: R } | { ok: false; error: unknown })[]> {
  const resultados: ({ ok: true; valor: R } | { ok: false; error: unknown })[] = new Array(items.length);
  let siguiente = 0;

  async function trabajador(): Promise<void> {
    while (siguiente < items.length) {
      const indice = siguiente++;
      try {
        resultados[indice] = { ok: true, valor: await tarea(items[indice], indice) };
      } catch (error) {
        resultados[indice] = { ok: false, error };
      }
    }
  }

  const numTrabajadores = Math.max(1, Math.min(limite, items.length));
  await Promise.all(Array.from({ length: numTrabajadores }, trabajador));
  return resultados;
}
