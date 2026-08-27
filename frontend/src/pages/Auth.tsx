import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../api/client";
import { useSession } from "../context/SessionContext";

interface AuthProps {
  /** Contenido opcional mostrado encima del formulario (p.ej. el resumen del onboarding). */
  cabecera?: ReactNode;
  modoInicial?: "registro" | "login";
  /** A dónde ir tras autenticarse. Por defecto, /home. */
  destino?: string;
}

export function Auth({ cabecera, modoInicial = "registro", destino = "/home" }: AuthProps) {
  const [modo, setModo] = useState<"registro" | "login">(modoInicial);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const { registrar, login, marcarOnboardingCompleto } = useSession();
  const navigate = useNavigate();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      if (modo === "registro") {
        await registrar(email, password);
      } else {
        await login(email, password);
      }
      marcarOnboardingCompleto();
      navigate(destino, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError("No se pudo completar la operación");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg rounded-2xl bg-white p-8 shadow-sm">
      {cabecera}
      <div className="mb-5 flex gap-2 rounded-lg bg-slate-100 p-1 text-sm">
        <button
          className={`flex-1 rounded-md py-2 font-medium ${modo === "registro" ? "bg-white shadow-sm" : "text-slate-500"}`}
          onClick={() => setModo("registro")}
          type="button"
        >
          Crear cuenta
        </button>
        <button
          className={`flex-1 rounded-md py-2 font-medium ${modo === "login" ? "bg-white shadow-sm" : "text-slate-500"}`}
          onClick={() => setModo("login")}
          type="button"
        >
          Ya tengo cuenta
        </button>
      </div>

      <form onSubmit={onSubmit} className="space-y-3">
        <input
          type="email"
          required
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
        />
        <input
          type="password"
          required
          minLength={8}
          placeholder="Contraseña (mínimo 8 caracteres)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
        />
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <button
          type="submit"
          disabled={enviando}
          className="w-full rounded-lg bg-indigo-600 px-4 py-3 font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {enviando ? "Un momento…" : modo === "registro" ? "Crear cuenta gratis" : "Iniciar sesión"}
        </button>
      </form>
    </div>
  );
}
