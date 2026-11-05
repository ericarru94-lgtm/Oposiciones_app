import "server-only";

// 0013 · Ventana de publicación: el código nuevo se publica ANTES de aplicar
// 0013. Mientras la base de datos no tenga el plan de misión, no se pueden
// crear encargos nuevos (se crearían sin plan y delegarían por el camino
// antiguo). Falla cerrado: solo hay LISTA con evidencia positiva.
//
// Por qué no se usa HEAD («select(..., { head: true })»): una petición HEAD a
// una tabla que no existe recibe un 404 SIN cuerpo, y postgrest-js lo convierte
// en «204 No Content» con error = null. Así se dio por lista una base de datos
// sin 0013. Ahora se hace un GET normal de cero filas y se exige todo esto:
// - error === null;
// - estado 200 o 206 (respuesta correcta de PostgREST; 206 = parcial con recuento);
// - data es una lista vacía (se pidieron cero filas);
// - count es un entero ≥ 0, que solo existe si PostgREST mandó Content-Range en
//   una respuesta correcta (descarta el arreglo de postgrest-js que convierte un
//   404 con cuerpo de lista en «200 []» sin recuento).
// Cualquier otra cosa (404, 401, 403, 500, error de red, tiempo agotado,
// respuesta inesperada o excepción) es NO LISTA.

export const PLAN_PROBE_TIMEOUT_MS = 5_000;

type ProbeResult = { error: unknown; data: unknown; count: number | null; status: number };
type Probe = {
  from(table: string): {
    select(cols: string, opts: { count: "exact" }): {
      limit(n: number): { abortSignal(signal: AbortSignal): PromiseLike<ProbeResult> };
    };
  };
};

/** true solo si la respuesta demuestra que la tabla existe y se puede leer. */
export function isPositivePlanProbe(res: unknown): boolean {
  if (!res || typeof res !== "object") return false;
  const r = res as Partial<ProbeResult>;
  return (
    r.error === null &&
    (r.status === 200 || r.status === 206) &&
    Array.isArray(r.data) &&
    r.data.length === 0 &&
    typeof r.count === "number" &&
    Number.isInteger(r.count) &&
    r.count >= 0
  );
}

export async function planSchemaReady(supabase: Probe, opts: { timeoutMs?: number } = {}): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? PLAN_PROBE_TIMEOUT_MS;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve("timeout");
      }, timeoutMs);
    });
    const query = Promise.resolve(
      supabase.from("mission_plans").select("id", { count: "exact" }).limit(0).abortSignal(controller.signal),
    );
    // Si la consulta falla después de agotarse el tiempo, no queda una promesa rechazada sin capturar.
    query.catch(() => undefined);
    const res = await Promise.race([query, timeout]);
    return res !== "timeout" && isPositivePlanProbe(res);
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const PLAN_SCHEMA_NOT_READY =
  "La oficina se está actualizando (falta aplicar la migración 0013 del plan de misión). No se pueden crear encargos nuevos hasta entonces.";
