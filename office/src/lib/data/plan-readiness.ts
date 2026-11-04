import "server-only";

// 0013 · Ventana de publicación: el código nuevo se publica ANTES de aplicar
// 0013. Mientras la base de datos no tenga el plan de misión, no se pueden
// crear encargos nuevos (se crearían sin plan y delegarían por el camino
// antiguo). Falla cerrado: ante cualquier error, se bloquea la creación.

type Probe = { from(table: string): { select(cols: string, opts: { head: true; count: "exact" }): PromiseLike<{ error: unknown }> } };

export async function planSchemaReady(supabase: Probe): Promise<boolean> {
  try {
    const { error } = await supabase.from("mission_plans").select("id", { head: true, count: "exact" });
    return !error;
  } catch {
    return false;
  }
}

export const PLAN_SCHEMA_NOT_READY =
  "La oficina se está actualizando (falta aplicar la migración 0013 del plan de misión). No se pueden crear encargos nuevos hasta entonces.";
