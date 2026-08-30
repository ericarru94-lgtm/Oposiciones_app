import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ApiError } from "../api/client";
import { darseDeBajaNewsletter } from "../api/endpoints";
import { PaginaEstatica } from "../components/PaginaEstatica";

export function NewsletterBaja() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const [estado, setEstado] = useState<"cargando" | "ok" | "error">("cargando");
  const [mensajeError, setMensajeError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setEstado("error");
      setMensajeError("Falta el token de baja en el enlace.");
      return;
    }
    darseDeBajaNewsletter(token)
      .then(() => setEstado("ok"))
      .catch((err) => {
        setEstado("error");
        setMensajeError(err instanceof ApiError ? err.message : "No se pudo procesar la baja.");
      });
  }, [token]);

  return (
    <PaginaEstatica icono="📭" titulo="Baja de la newsletter">
      {estado === "cargando" && <p>Procesando tu baja…</p>}
      {estado === "ok" && <p>Te hemos dado de baja de la newsletter de Aprobox. No recibirás más emails.</p>}
      {estado === "error" && <p>❌ {mensajeError}</p>}
    </PaginaEstatica>
  );
}
