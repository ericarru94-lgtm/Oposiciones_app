import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../api/client";
import { crearPortalSession, obtenerResumenProgreso } from "../api/endpoints";
import { useSession } from "../context/SessionContext";
import { AppLayout } from "../components/AppLayout";
import { RachaBadge } from "../components/RachaBadge";
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

  const email = perfilExterno?.email ?? usuario?.email ?? "";
  const iniciales = (perfilExterno?.nombreCompleto ?? email).slice(0, 2).toUpperCase();

  return (
    <AppLayout>
      <h1 className="mb-6 text-2xl font-bold text-slate-900">Tu perfil</h1>

      <div className="mb-8 flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5">
        {perfilExterno?.imagenUrl ? (
          <img src={perfilExterno.imagenUrl} alt="" className="h-16 w-16 rounded-full object-cover" />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-indigo-100 text-lg font-semibold text-indigo-700">
            {iniciales}
          </div>
        )}
        <div>
          <p className="text-lg font-semibold text-slate-900">{perfilExterno?.nombreCompleto || email}</p>
          <p className="text-sm text-slate-500">{email}</p>
          <span
            className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
              usuario?.plan === "premium" ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-600"
            }`}
          >
            Plan {usuario?.plan === "premium" ? "premium" : "gratuito"}
          </span>

          {usuario?.plan === "premium" ? (
            <div className="mt-2">
              <button
                onClick={gestionarSuscripcion}
                disabled={procesandoPortal}
                className="text-sm font-medium text-indigo-600 hover:underline disabled:opacity-60"
              >
                {procesandoPortal ? "Abriendo…" : "Gestionar suscripción"}
              </button>
              {errorPortal && <p className="mt-1 text-xs text-rose-600">{errorPortal}</p>}
            </div>
          ) : (
            <div className="mt-2">
              <button
                onClick={() => navigate("/upgrade")}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
              >
                Hazte premium
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-400">Preguntas respondidas</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{resumen ? resumen.totalIntentos : "—"}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-400">% de acierto</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">
            {resumen?.precision !== null && resumen?.precision !== undefined
              ? `${Math.round(resumen.precision * 100)}%`
              : "—"}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="mb-1 text-xs text-slate-400">Racha</p>
          {resumen ? <RachaBadge dias={resumen.racha.dias} /> : <p className="text-2xl font-bold text-slate-900">—</p>}
        </div>
      </div>
    </AppLayout>
  );
}
