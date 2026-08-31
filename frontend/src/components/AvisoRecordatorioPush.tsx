import { useEffect, useState } from "react";
import { useSession } from "../context/SessionContext";
import { activarRecordatorioDiario, soportaNotificacionesPush } from "../lib/notificacionesPush";

const CLAVE_DESCARTADO = "aprobox-push-descartado";

/**
 * Aviso no intrusivo (una tarjeta propia, nunca el permiso nativo del
 * navegador sin avisar antes) para activar el recordatorio diario de
 * repaso. Solo se ofrece cuando: el navegador lo soporta, el usuario
 * lleva al menos 2 días de racha (`diasRacha`, ver Home.tsx), el
 * permiso del navegador todavía no se ha concedido/denegado, y no lo ha
 * descartado antes desde aquí. Si el usuario lo rechaza, no se vuelve a
 * mostrar en esta sesión de navegador (localStorage) — no es una función
 * imprescindible como para insistir.
 */
export function AvisoRecordatorioPush({ diasRacha }: { diasRacha: number }) {
  const { getToken } = useSession();
  const [visible, setVisible] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);

  useEffect(() => {
    if (diasRacha < 2) return;
    if (!soportaNotificacionesPush()) return;
    if (Notification.permission !== "default") return;
    if (localStorage.getItem(CLAVE_DESCARTADO)) return;
    setVisible(true);
  }, [diasRacha]);

  if (!visible) return null;

  async function activar() {
    setEnviando(true);
    setMensaje(null);
    const token = await getToken();
    if (!token) {
      setEnviando(false);
      return;
    }
    const resultado = await activarRecordatorioDiario(token);
    setEnviando(false);
    if (resultado.ok) {
      setVisible(false);
      return;
    }
    if (resultado.motivo === "permiso-denegado") {
      // El usuario ya ha decidido que no, desde el diálogo nativo: respetarlo, no insistir más.
      localStorage.setItem(CLAVE_DESCARTADO, "1");
      setVisible(false);
      return;
    }
    if (resultado.motivo === "no-disponible") {
      setMensaje("Las notificaciones no están disponibles todavía. Inténtalo de nuevo más adelante.");
      return;
    }
    setMensaje("No se ha podido activar el recordatorio. Puedes intentarlo de nuevo cuando quieras.");
  }

  function descartar() {
    localStorage.setItem(CLAVE_DESCARTADO, "1");
    setVisible(false);
  }

  return (
    <div className="mb-6 flex items-center justify-between gap-4 rounded-2xl border border-line bg-card p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-xl">
          🔔
        </span>
        <div>
          <p className="text-sm font-semibold text-ink">¿Te avisamos cada día para repasar?</p>
          <p className="text-xs text-muted">
            {mensaje ?? "Un recordatorio diario para no perder la racha. Puedes desactivarlo cuando quieras."}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        <button
          onClick={descartar}
          disabled={enviando}
          className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted hover:bg-canvas disabled:opacity-50"
        >
          Ahora no
        </button>
        <button
          onClick={activar}
          disabled={enviando}
          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
        >
          {enviando ? "Activando…" : "Sí, avísame"}
        </button>
      </div>
    </div>
  );
}
