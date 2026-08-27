import { useState, type ReactNode } from "react";
import { SignIn, SignUp } from "@clerk/clerk-react";
import { iniciarSesionBypass, usandoClerk } from "../context/SessionContext";

interface AuthProps {
  /** Contenido opcional mostrado encima del formulario (p.ej. el resumen del onboarding). */
  cabecera?: ReactNode;
  modoInicial?: "registro" | "login";
  /** A dónde ir tras autenticarse. Por defecto, /home. */
  destino?: string;
}

/**
 * Registro/login: los componentes de Clerk en un despliegue normal, o un
 * formulario mínimo (solo email) en el modo bypass exclusivo de E2E — ver
 * context/SessionContext.tsx para por qué existen los dos modos.
 */
export function Auth({ cabecera, modoInicial = "registro", destino = "/home" }: AuthProps) {
  if (!usandoClerk) {
    return <AuthBypass cabecera={cabecera} modoInicial={modoInicial} destino={destino} />;
  }
  return (
    <div className="mx-auto max-w-lg">
      {cabecera}
      <div className="rounded-2xl bg-white p-2 shadow-sm">
        {modoInicial === "registro" ? (
          <SignUp routing="hash" fallbackRedirectUrl={destino} signInUrl="/login" />
        ) : (
          <SignIn routing="hash" fallbackRedirectUrl={destino} signUpUrl="/registro" />
        )}
      </div>
    </div>
  );
}

function AuthBypass({
  cabecera,
  modoInicial,
  destino,
}: {
  cabecera?: ReactNode;
  modoInicial: "registro" | "login";
  destino: string;
}) {
  const [email, setEmail] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      await iniciarSesionBypass(email, destino);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo completar la operación");
      setEnviando(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg rounded-2xl bg-white p-8 shadow-sm">
      {cabecera}
      <p className="mb-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-700">
        Modo E2E sin Clerk configurado: inicia sesión solo con un email, sin contraseña.
      </p>
      <form onSubmit={onSubmit} className="space-y-3">
        <input
          type="email"
          required
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
        />
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <button
          type="submit"
          disabled={enviando}
          className="w-full rounded-lg bg-indigo-600 px-4 py-3 font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {enviando ? "Un momento…" : modoInicial === "registro" ? "Crear cuenta gratis" : "Iniciar sesión"}
        </button>
      </form>
    </div>
  );
}
