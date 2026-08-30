import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ApiError } from "../api/client";
import { confirmarNewsletter } from "../api/endpoints";
import { PaginaEstatica } from "../components/PaginaEstatica";

export function NewsletterConfirmar() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const [estado, setEstado] = useState<"cargando" | "ok" | "error">("cargando");
  const [mensajeError, setMensajeError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setEstado("error");
      setMensajeError("Falta el token de confirmación en el enlace.");
      return;
    }
    confirmarNewsletter(token)
      .then(() => setEstado("ok"))
      .catch((err) => {
        setEstado("error");
        setMensajeError(err instanceof ApiError ? err.message : "No se pudo confirmar la suscripción.");
      });
  }, [token]);

  return (
    <PaginaEstatica icono="📬" titulo="Confirmar suscripción">
      {estado === "cargando" && <p>Confirmando tu suscripción…</p>}
      {estado === "ok" && <p>✅ ¡Listo! Tu suscripción a la newsletter de Aprobox está confirmada.</p>}
      {estado === "error" && <p>❌ {mensajeError}</p>}
    </PaginaEstatica>
  );
}
