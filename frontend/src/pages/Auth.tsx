import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { SignIn, SignUp } from "@clerk/clerk-react";
import { iniciarSesionBypass, usandoClerk } from "../context/SessionContext";

/**
 * Clerk no ofrece un botón "volver" propio en `<SignIn>`/`<SignUp>` (son un
 * widget autocontenido pensado para ocupar el foco de la pantalla, sin
 * chrome de navegación): el enlace de vuelta a la landing es un elemento
 * propio, adyacente al widget, no una opción de configuración de Clerk.
 */
function VolverALaWeb() {
  return (
    <Link
      to="/"
      className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-ink"
    >
      ← Volver a Aprobox
    </Link>
  );
}

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
  // Se propaga `destino` a la URL del otro formulario (el enlace "¿Ya
  // tienes cuenta?"/"Crear cuenta" dentro del propio componente de Clerk)
  // para que cambiar de login a registro (o viceversa) no pierda a dónde
  // había que volver — p.ej. /upgrade?continuar=1 al suscribirse sin sesión.
  const destinoQS = encodeURIComponent(destino);
  return (
    <div className="mx-auto max-w-lg">
      <VolverALaWeb />
      {cabecera}
      <div className="rounded-2xl bg-card p-2 shadow-sm">
        {modoInicial === "registro" ? (
          <SignUp routing="hash" fallbackRedirectUrl={destino} signInUrl={`/login?destino=${destinoQS}`} />
        ) : (
          <SignIn routing="hash" fallbackRedirectUrl={destino} signUpUrl={`/registro?destino=${destinoQS}`} />
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
    <div className="mx-auto max-w-lg rounded-3xl bg-card p-8 shadow-sm">
      <VolverALaWeb />
      {cabecera}
      <p className="mb-4 rounded-lg bg-accent/10 p-3 text-xs text-accent">
        Modo E2E sin Clerk configurado: inicia sesión solo con un email, sin contraseña.
      </p>
      <form onSubmit={onSubmit} className="space-y-3">
        <input
          type="email"
          required
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg border border-line px-3 py-2.5 text-sm focus:border-primary focus:outline-none"
        />
        {error && <p className="text-sm text-error">{error}</p>}
        <button
          type="submit"
          disabled={enviando}
          className="w-full rounded-xl bg-primary px-4 py-3 font-medium text-white hover:bg-primary-hover disabled:opacity-60"
        >
          {enviando ? "Un momento…" : modoInicial === "registro" ? "Crear cuenta gratis" : "Iniciar sesión"}
        </button>
      </form>
    </div>
  );
}
