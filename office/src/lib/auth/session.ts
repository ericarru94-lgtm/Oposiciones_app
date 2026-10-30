import "server-only";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { authMode, readEnv } from "../env";
import { createSupabaseServerClient } from "../supabase/server";

export type Viewer =
  | { mode: "admin"; userId: string; email: string }
  | { mode: "local-preview" };

/**
 * Exige que quien ve la página sea el administrador de HE Signal:
 * sesión válida + email igual a ADMIN_EMAIL + fila en public.admins.
 */
export async function requireViewer(): Promise<Viewer> {
  // Nunca prerenderizar: la configuración y la sesión se leen en cada petición.
  await connection();
  const env = readEnv();
  const mode = authMode(env);
  if (mode === "local-preview") return { mode: "local-preview" };
  if (mode === "not-configured") redirect("/login?error=config");

  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user?.email) redirect("/login");

  const isConfiguredAdmin = user.email.toLowerCase() === env.ADMIN_EMAIL!.toLowerCase();
  const { data: adminRow } = await supabase.from("admins").select("user_id").eq("user_id", user.id).maybeSingle();
  if (!isConfiguredAdmin || !adminRow) {
    await supabase.auth.signOut();
    redirect("/login?error=forbidden");
  }
  return { mode: "admin", userId: user.id, email: user.email };
}
