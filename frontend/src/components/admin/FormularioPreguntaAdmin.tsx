import { useState } from "react";
import { ApiError } from "../../api/client";
import { actualizarPreguntaAdmin } from "../../api/endpoints";
import { useSession } from "../../context/SessionContext";
import type { Opcion, PreguntaAdmin } from "../../api/types";

const OPCIONES: Opcion[] = ["a", "b", "c", "d"];

interface Props {
  pregunta: PreguntaAdmin;
  onCompletado: () => void;
  onSaltar: () => void;
}

/** Formulario de edición de una pregunta para el admin: se remonta (key=pregunta.id en el padre) al cambiar de pregunta. */
export function FormularioPreguntaAdmin({ pregunta, onCompletado, onSaltar }: Props) {
  const { getToken } = useSession();
  const [enunciado, setEnunciado] = useState(pregunta.enunciado);
  const [opciones, setOpciones] = useState<string[]>(pregunta.opciones);
  const [respuestaCorrecta, setRespuestaCorrecta] = useState<Opcion | null>(pregunta.respuestaCorrecta);
  const [explicacion, setExplicacion] = useState(pregunta.explicacion ?? "");
  const [fuente, setFuente] = useState(pregunta.fuente ?? "");
  const [fuenteUrl, setFuenteUrl] = useState(pregunta.fuenteUrl ?? "");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function cambiarOpcion(i: number, valor: string) {
    setOpciones((prev) => prev.map((o, idx) => (idx === i ? valor : o)));
  }

  async function guardar(nuevoEstado?: "verificada" | "anulada" | "borrador") {
    setError(null);
    setEnviando(true);
    try {
      const token = await getToken();
      await actualizarPreguntaAdmin(token as string, pregunta.id, {
        enunciado,
        opciones,
        respuestaCorrecta,
        explicacion: explicacion || null,
        fuente: fuente || null,
        fuenteUrl: fuenteUrl || null,
        estado: nuevoEstado,
      });
      onCompletado();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar la pregunta");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between text-xs text-slate-400">
        <span>
          {pregunta.tema ? `Tema ${pregunta.tema.numero}. ${pregunta.tema.nombre}` : "Sin tema (psicotécnica)"}
        </span>
        <span>
          {pregunta.id} · {pregunta.origen === "examen_oficial" ? "examen oficial" : "generada por IA"}
          {pregunta.convocatoria ? ` · ${pregunta.convocatoria}` : ""}
        </span>
      </div>

      <label className="block text-xs font-medium text-slate-500">Enunciado</label>
      <textarea
        aria-label="Enunciado"
        value={enunciado}
        onChange={(e) => setEnunciado(e.target.value)}
        rows={3}
        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
      />

      {pregunta.tablaDatos && (
        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
          <p className="border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-500">
            {pregunta.tablaDatos.titulo} (no editable aquí — editar en el dataset)
          </p>
          <table className="min-w-full text-left text-xs">
            <thead>
              <tr>
                {pregunta.tablaDatos.columnas.map((c) => (
                  <th key={c} className="whitespace-nowrap px-3 py-1.5 font-semibold text-slate-500">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pregunta.tablaDatos.filas.map((fila, i) => (
                <tr key={i} className="border-t border-slate-100">
                  {fila.map((celda, j) => (
                    <td key={j} className="whitespace-nowrap px-3 py-1.5 text-slate-700">
                      {celda}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 space-y-2">
        {opciones.map((texto, i) => {
          const opcion = OPCIONES[i];
          return (
            <div key={opcion} className="flex items-center gap-2">
              <input
                type="radio"
                name={`respuesta-${pregunta.id}`}
                checked={respuestaCorrecta === opcion}
                onChange={() => setRespuestaCorrecta(opcion)}
                className="h-4 w-4 accent-emerald-600"
                aria-label={`Marcar ${opcion} como respuesta correcta`}
              />
              <span className="text-xs font-semibold uppercase text-slate-400">{opcion}</span>
              <input
                value={texto}
                onChange={(e) => cambiarOpcion(i, e.target.value)}
                className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:border-indigo-400 focus:outline-none"
              />
            </div>
          );
        })}
      </div>
      {!respuestaCorrecta && (
        <p className="mt-2 text-xs text-amber-600">Selecciona la respuesta correcta para poder verificarla.</p>
      )}

      <label className="mt-4 block text-xs font-medium text-slate-500">Explicación (opcional)</label>
      <textarea
        value={explicacion}
        onChange={(e) => setExplicacion(e.target.value)}
        rows={2}
        placeholder="Por qué es correcta esta opción…"
        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
      />

      <label className="mt-3 block text-xs font-medium text-slate-500">Fuente legal (opcional)</label>
      <input
        value={fuente}
        onChange={(e) => setFuente(e.target.value)}
        placeholder="Art. X de la Ley Y"
        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
      />

      <label className="mt-3 block text-xs font-medium text-slate-500">Enlace al BOE (opcional)</label>
      <input
        value={fuenteUrl}
        onChange={(e) => setFuenteUrl(e.target.value)}
        placeholder="https://www.boe.es/buscar/act.php?id=BOE-A-…#aX"
        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
      />

      {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          disabled={enviando || !respuestaCorrecta}
          onClick={() => guardar("verificada")}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          Verificar
        </button>
        <button
          disabled={enviando}
          onClick={() => guardar()}
          className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Guardar sin verificar
        </button>
        <button
          disabled={enviando}
          onClick={() => {
            if (confirm("¿Anular esta pregunta? Dejará de servirse a los usuarios.")) guardar("anulada");
          }}
          className="rounded-lg border border-rose-200 px-4 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50"
        >
          Anular
        </button>
        <button
          disabled={enviando}
          onClick={onSaltar}
          className="ml-auto rounded-lg px-4 py-2 text-sm font-medium text-slate-400 hover:text-slate-600"
        >
          Saltar
        </button>
      </div>
    </div>
  );
}
