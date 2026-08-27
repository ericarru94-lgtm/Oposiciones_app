import { useEffect, useState } from "react";
import { obtenerColaRevision, obtenerResumenTemasAdmin } from "../../api/endpoints";
import { useSession } from "../../context/SessionContext";
import { AppLayout } from "../../components/AppLayout";
import { FormularioPreguntaAdmin } from "../../components/admin/FormularioPreguntaAdmin";
import type { Bloque, EstadoPregunta, PreguntaAdmin, ResumenTemaAdmin } from "../../api/types";

const SIN_TEMA = "sin-tema";

export function Revision() {
  const { getToken } = useSession();
  const [estadoFiltro, setEstadoFiltro] = useState<EstadoPregunta>("borrador");
  const [bloqueFiltro, setBloqueFiltro] = useState<Bloque | "">("");
  const [temaFiltro, setTemaFiltro] = useState<string>(""); // "" = todos, número como string, o SIN_TEMA

  const [resumenTemas, setResumenTemas] = useState<ResumenTemaAdmin[] | null>(null);
  const [sinTemaPendientes, setSinTemaPendientes] = useState(0);
  const [cola, setCola] = useState<PreguntaAdmin[] | null>(null);

  async function recargarResumen() {
    const token = await getToken();
    if (!token) return;
    const r = await obtenerResumenTemasAdmin(token, estadoFiltro);
    setResumenTemas(r.temas);
    setSinTemaPendientes(r.sinTema.pendientes);
  }

  useEffect(() => {
    void recargarResumen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getToken, estadoFiltro]);

  useEffect(() => {
    setCola(null);
    (async () => {
      const token = await getToken();
      if (!token) return;
      const r = await obtenerColaRevision(token, {
        estado: estadoFiltro,
        bloque: bloqueFiltro || undefined,
        temaId: temaFiltro && temaFiltro !== SIN_TEMA ? Number(temaFiltro) : undefined,
        sinTema: temaFiltro === SIN_TEMA,
      });
      setCola(r.preguntas);
    })();
  }, [getToken, estadoFiltro, bloqueFiltro, temaFiltro]);

  function avanzar() {
    setCola((prev) => (prev ? prev.slice(1) : prev));
  }

  const temasDelBloque = (resumenTemas ?? []).filter((t) => !bloqueFiltro || t.bloque === bloqueFiltro);
  const totalEnCola = cola?.length ?? 0;

  return (
    <AppLayout>
      <h1 className="mb-1 text-2xl font-bold text-slate-900">Revisión editorial</h1>
      <p className="mb-6 text-sm text-slate-500">
        Revisa preguntas una a una, corrige lo que haga falta y márcalas como verificadas o anuladas.
      </p>

      <div className="mb-6 flex flex-wrap gap-3">
        <select
          value={estadoFiltro}
          onChange={(e) => setEstadoFiltro(e.target.value as EstadoPregunta)}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
        >
          <option value="borrador">Borrador (pendientes)</option>
          <option value="verificada">Verificadas</option>
          <option value="anulada">Anuladas</option>
        </select>

        <select
          value={bloqueFiltro}
          onChange={(e) => {
            setBloqueFiltro(e.target.value as Bloque | "");
            setTemaFiltro("");
          }}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
        >
          <option value="">Todos los bloques</option>
          <option value="I">Bloque I</option>
          <option value="II">Bloque II</option>
        </select>

        <select
          value={temaFiltro}
          onChange={(e) => setTemaFiltro(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
        >
          <option value="">Todos los temas</option>
          {temasDelBloque.map((t) => (
            <option key={t.id} value={t.id}>
              Tema {t.numero}. {t.nombre} ({t.pendientes})
            </option>
          ))}
          {(!bloqueFiltro || bloqueFiltro === "II") && (
            <option value={SIN_TEMA}>Psicotécnicas, sin tema ({sinTemaPendientes})</option>
          )}
        </select>
      </div>

      {cola === null && <p className="text-slate-400">Cargando…</p>}

      {cola !== null && cola.length === 0 && (
        <div className="rounded-2xl bg-white p-8 text-center text-slate-500 shadow-sm">
          No hay preguntas en estado "{estadoFiltro}" con este filtro. ¡Al día!
        </div>
      )}

      {cola !== null && cola.length > 0 && (
        <>
          <p className="mb-3 text-sm text-slate-500">{totalEnCola} en esta cola</p>
          <FormularioPreguntaAdmin
            key={cola[0].id}
            pregunta={cola[0]}
            onCompletado={() => {
              avanzar();
              recargarResumen();
            }}
            onSaltar={avanzar}
          />
        </>
      )}
    </AppLayout>
  );
}
