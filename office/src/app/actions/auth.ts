"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { authMode, readEnv } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const credentials = z.object({
  email: z.email(),
  password: z.string().min(8).max(200),
});

export type LoginState = { error: string | null };

export async function signIn(_prev: LoginState, form: FormData): Promise<LoginState> {
  const env = readEnv();
  if (authMode(env) !== "supabase") {
    return { error: "El inicio de sesión todavía no está configurado (faltan las variables de Supabase)." };
  }
  const parsed = credentials.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: "Revisa el email y la contraseña." };

  // Solo el administrador configurado puede entrar. Mensaje genérico a propósito.
  if (parsed.data.email.toLowerCase() !== env.ADMIN_EMAIL!.toLowerCase()) {
    return { error: "Email o contraseña incorrectos." };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error || !data.user) return { error: "Email o contraseña incorrectos." };

  await supabase.from("activity_log").insert({
    actor_type: "admin",
    actor_id: data.user.id,
    action: "auth.login",
  });
  redirect("/");
}

export async function signOut() {
  if (authMode() === "supabase") {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
  redirect("/login");
}
