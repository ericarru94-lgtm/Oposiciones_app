import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../api/client";
import { crearPortalSession, obtenerResumenProgreso } from "../api/endpoints";
import { useSession } from "../context/SessionContext";
import { AppLayout } from "../components/AppLayout";
import { RachaBadge } from "../components/RachaBadge";
import { StatTile } from "../components/StatTile";
import type { ProgresoResumen } from "../api/types";

/** Combina datos de identidad (Clerk: nombre, email, foto) con datos propios (plan, progreso, racha). */
export function Perfil() {
  const { usuario, perfilExterno, getToken } = useSession();
  const navigate = useNavigate();
  const [resumen, setResumen] = useState<ProgresoResumen | null>(null);
  const [procesandoPortal, setProcesandoPortal] = useState(false);
  const [errorPortal, setErrorPortal] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const token = await getToken();
      if (!token) return;
      const r = await obtenerResumenProgreso(token);
      if (!cancelado) setResumen(r);
    })();
    return () => {
      cancelado = true;
    };
  }, [getToken]);

  async function gestionarSuscripcion() {
    setErrorPortal(null);
    setProcesandoPortal(true);
    try {
      const token = await getToken();
      const { url } = await crearPortalSession(token as string);
      window.location.href = url;
    } catch (err) {
      setErrorPortal(err instanceof ApiError ? err.message : "No se pudo abrir la gestión de la suscripción.");
      setProcesandoPortal(false);
    }
  }

  const esPremium = usuario?.plan === "premium";
  const email = perfilExterno?.email ?? usuario?.email ?? "";
  const iniciales = (perfilExterno?.nombreCompleto ?? email).slice(0, 2).toUpperCase();

  return (
    <AppLayout>
      <h1 className="mb-6 text-2xl font-bold text-ink">Tu perfil</h1>

      <div
        className={`mb-8 overflow-hidden rounded-2xl border ${esPremium ? "border-accent/30" : "border-line"} bg-card`}
      >
        <div className={`h-3 ${esPremium ? "bg-accent" : "bg-primary"}`} />
        <div className="flex items-center gap-4 p-6">
          {perfilExterno?.imagenUrl ? (
            <img src={perfilExterno.imagenUrl} alt="" className="h-16 w-16 rounded-full object-cover" />
          ) : (
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-primary/10 text-lg font-semibold text-primary">
              {iniciales}
            </div>
          )}
          <div>
            <p className="text-lg font-semibold text-ink">{perfilExterno?.nombreCompleto || email}</p>
            <p className="text-sm text-muted">{email}</p>
            <span
              className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                esPremium ? "bg-accent/10 text-accent" : "bg-primary/10 text-primary"
              }`}
            >
              {esPremium ? "⭐ Plan premium" : "Plan gratuito"}
            </span>

            {esPremium ? (
              <div className="mt-3">
                <button
                  onClick={gestionarSuscripcion}
                  disabled={procesandoPortal}
                  className="rounded-lg border border-line bg-card px-3 py-1.5 text-sm font-medium text-primary hover:border-primary/40 disabled:opacity-60"
                >
                  {procesandoPortal ? "Abriendo…" : "Gestionar suscripción"}
                </button>
                {errorPortal && <p className="mt-1 text-xs text-error">{errorPortal}</p>}
              </div>
            ) : (
              <div className="mt-3">
                <button
                  onClick={() => navigate("/upgrade")}
                  className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover"
                >
                  Hazte premium
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatTile icono="📝" label="Preguntas respondidas" valor={resumen ? resumen.totalIntentos : "—"} />
        <StatTile
          icono="🎯"
          label="% de acierto"
          valor={
            resumen?.precision !== null && resumen?.precision !== undefined
              ? `${Math.round(resumen.precision * 100)}%`
              : "—"
          }
        />
        <div className="rounded-xl border border-line bg-card p-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-base">🔥</div>
          <p className="mt-3 mb-1 text-xs text-muted">Racha</p>
          {resumen ? <RachaBadge dias={resumen.racha.dias} /> : <p className="text-2xl font-bold text-ink">—</p>}
        </div>
      </div>
    </AppLayout>
  );
}
