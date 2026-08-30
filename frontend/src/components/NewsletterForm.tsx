import { useState } from "react";
import { ApiError } from "../api/client";
import { suscribirseNewsletter } from "../api/endpoints";

/**
 * Alta a la newsletter. El checkbox de consentimiento nunca empieza
 * marcado (RGPD: consentimiento explícito, no implícito) y el envío
 * queda deshabilitado hasta que el usuario lo marque él mismo.
 */
export function NewsletterForm({ className = "" }: { className?: string }) {
  const [email, setEmail] = useState("");
  const [consiente, setConsiente] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<"ok" | "ya_suscrito" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function alEnviar(e: React.FormEvent) {
    e.preventDefault();
    if (!consiente) return;
    setEnviando(true);
    setError(null);
    try {
      const { estado } = await suscribirseNewsletter(email, true);
      setResultado(estado === "confirmado" ? "ya_suscrito" : "ok");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo completar la suscripción. Inténtalo de nuevo.");
    } finally {
      setEnviando(false);
    }
  }

  if (resultado === "ok") {
    return (
      <div className={`rounded-2xl border border-success/30 bg-success/10 p-5 text-sm text-ink ${className}`}>
        ✅ ¡Gracias! Te hemos enviado un email para confirmar tu suscripción — hazlo desde ahí para empezar a
        recibir novedades.
      </div>
    );
  }
  if (resultado === "ya_suscrito") {
    return (
      <div className={`rounded-2xl border border-line bg-card p-5 text-sm text-muted ${className}`}>
        Este email ya está suscrito a la newsletter.
      </div>
    );
  }

  return (
    <form onSubmit={alEnviar} className={`rounded-2xl border border-line bg-card p-5 ${className}`}>
      <p className="text-sm font-semibold text-ink">📬 No te pierdas nada</p>
      <p className="mt-1 text-sm text-muted">
        Recordatorios de racha, novedades y contenido nuevo, sin spam. Puedes darte de baja cuando quieras.
      </p>

      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="tu@email.com"
        className="mt-4 w-full rounded-xl border border-line bg-canvas px-4 py-2.5 text-sm text-ink placeholder:text-muted focus:border-primary focus:outline-none"
      />

      <label className="mt-3 flex items-start gap-2 text-xs text-muted">
        <input
          type="checkbox"
          checked={consiente}
          onChange={(e) => setConsiente(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-line text-primary focus:ring-primary"
        />
        Acepto recibir estos emails y que Aprobox trate mi email con esa finalidad (ver{" "}
        <a href="/privacidad" className="underline hover:text-ink">
          Política de privacidad
        </a>
        ).
      </label>

      {error && <p className="mt-2 text-xs text-error">{error}</p>}

      <button
        type="submit"
        disabled={!consiente || enviando}
        className="mt-4 w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {enviando ? "Enviando…" : "Suscribirme"}
      </button>
    </form>
  );
}
