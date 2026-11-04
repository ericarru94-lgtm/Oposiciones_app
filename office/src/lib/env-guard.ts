// Barrera de entorno (sin «server-only»: la usa también proxy.ts).
//
// Una vista previa de Vercel NUNCA puede usar el Supabase de producción. Si lo
// intenta (variables mal asignadas, o una vista previa compilada antes de
// aislarla), la oficina se comporta como «sin configurar»: no se conecta, no
// hay sesión ni datos. Falla cerrado. Producción y el entorno local no cambian.

/** Referencia del proyecto Supabase de producción (pública: forma parte de su URL). */
export const PRODUCTION_SUPABASE_REF = "bgptbtmyhtobqohkoeyd";

export function isProductionSupabaseUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === `${PRODUCTION_SUPABASE_REF}.supabase.co` || host.startsWith(`${PRODUCTION_SUPABASE_REF}.`);
  } catch {
    return false;
  }
}

/** true si esta ejecución es una vista previa de Vercel que apunta al Supabase de producción. */
export function previewUsesProductionSupabase(source: Record<string, string | undefined> = process.env): boolean {
  return source.VERCEL_ENV === "preview" && isProductionSupabaseUrl(source.NEXT_PUBLIC_SUPABASE_URL);
}
