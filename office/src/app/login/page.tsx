import Link from "next/link";
import { connection } from "next/server";
import { OfficeLogo } from "@/components/logo";
import { authMode } from "@/lib/env";
import { LoginForm } from "./login-form";

const ERRORS: Record<string, string> = {
  forbidden: "Esta cuenta no es la del administrador de HE Signal.",
  config: "Falta configurar Supabase. Sigue los pasos de docs/INSTALACION.md.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;
  await connection();
  const mode = authMode();
  const message = typeof error === "string" ? ERRORS[error] : undefined;

  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm rounded-2xl bg-surface/80 ring-1 ring-white/5 p-8">
        <OfficeLogo />
        <h1 className="mt-8 font-display text-2xl font-semibold">Acceso de administrador</h1>
        <p className="mt-2 text-sm text-muted">Solo la cuenta del administrador de HE Signal Agency puede entrar.</p>
        {message && <p className="mt-4 rounded-lg bg-signal/10 p-3 text-sm text-signal">{message}</p>}
        {mode === "local-preview" && (
          <p className="mt-4 rounded-lg bg-cobalt/15 p-3 text-sm">
            Vista previa local activa: <Link className="underline" href="/">entrar sin base de datos</Link>.
          </p>
        )}
        <div className="mt-6">
          <LoginForm disabled={mode !== "supabase"} />
        </div>
      </div>
    </main>
  );
}
