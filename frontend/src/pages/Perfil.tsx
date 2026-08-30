import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../api/client";
import { crearPortalSession, obtenerProgresoPorTema } from "../api/endpoints";
import { useSession } from "../context/SessionContext";
import { AppLayout } from "../components/AppLayout";
import { PageTitle } from "../components/PageTitle";
import { NewsletterForm } from "../components/NewsletterForm";
import type { ProgresoPorTema } from "../api/types";

/** Un tema cuenta como "dominado" con el mismo criterio que la insignia de TemaCard. */
function esDominado(tema: ProgresoPorTema): boolean {
  const cobertura = tema.totalPreguntas > 0 ? tema.preguntasContestadas / tema.totalPreguntas : 0;
  return cobertura >= 1 && (tema.precision ?? 0) >= 0.9;
}

/** Combina datos de identidad (Clerk: nombre, email, foto) con datos propios (plan, cuenta, logros). */
export function Perfil() {
  const { usuario, perfilExterno, getToken } = useSession();
  const navigate = useNavigate();
  const [temas, setTemas] = useState<ProgresoPorTema[] | null>(null);
  const [procesandoPortal, setProcesandoPortal] = useState(false);
  const [errorPortal, setErrorPortal] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const token = await getToken();
      if (!token) return;
      const { temas } = await obtenerProgresoPorTema(token);
      if (!cancelado) setTemas(temas);
    })();
    return () => {
      cancelado = true;
    };
  }, [getToken]);

  const temasDominados = (temas ?? []).filter(esDominado);
  const desdeFecha = usuario?.createdAt
    ? new Date(usuario.createdAt).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" })
    : null;

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
      <PageTitle icono="👤">Tu perfil</PageTitle>

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
                {usuario?.cancelaAlFinalizarPeriodo && (
                  <p className="mb-2 text-xs text-accent">
                    ⚠️ Suscripción cancelada: tendrás acceso premium hasta el{" "}
                    {usuario.premiumHasta ? new Date(usuario.premiumHasta).toLocaleDateString("es-ES") : "fin del periodo actual"}.
                  </p>
                )}
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

      {desdeFecha && (
        <div className="mb-6 rounded-2xl border border-line bg-card p-5">
          <p className="text-sm text-muted">📅 Opositando desde {desdeFecha}</p>
        </div>
      )}

      <div className="rounded-2xl border border-line bg-card p-6">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-ink">🏅 Logros</h2>
        {temas === null && <p className="text-sm text-muted">Cargando…</p>}
        {temas !== null && temasDominados.length === 0 && (
          <p className="text-sm text-muted">
            Aún no tienes temas dominados. Practica un tema hasta completarlo con ≥90% de acierto para conseguir tu
            primera insignia.
          </p>
        )}
        {temasDominados.length > 0 && (
          <ul className="space-y-2">
            {temasDominados.map((tema) => (
              <li
                key={tema.temaId}
                className="flex items-center gap-2 rounded-xl bg-success/5 px-4 py-3 text-sm font-medium text-ink"
              >
                <span aria-hidden>🏆</span> Tema {tema.numero}. {tema.nombre}
              </li>
            ))}
          </ul>
        )}
      </div>

      <NewsletterForm className="mt-6" />
    </AppLayout>
  );
}
