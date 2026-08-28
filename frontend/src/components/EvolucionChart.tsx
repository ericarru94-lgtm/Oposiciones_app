import { useState } from "react";
import type { EvolucionDia } from "../api/types";

const ALTO = 160;
const ANCHO = 600;
const PADDING_IZQ = 32;
const PADDING_INF = 20;
const COLOR_DATO = "#4338CA";
const COLOR_SIN_DATOS = "#e1e0d9";
const COLOR_EJE = "#c3c2b7";
const COLOR_TEXTO_MUTED = "#898781";

/**
 * Barras de la evolución diaria del % de acierto (una sola serie: sequential
 * de un solo hue, sin necesidad de leyenda). Los días sin intentos se pintan
 * en gris para no confundir "0 preguntas ese día" con "0% de acierto".
 */
export function EvolucionChart({ serie }: { serie: EvolucionDia[] }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const areaAlto = ALTO - PADDING_INF;
  const anchoBanda = (ANCHO - PADDING_IZQ) / serie.length;
  const anchoBarra = Math.min(24, anchoBanda * 0.6);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${ANCHO} ${ALTO}`} className="w-full" role="img" aria-label="Evolución del porcentaje de acierto por día">
        {[0, 50, 100].map((valor) => {
          const y = areaAlto - (valor / 100) * areaAlto;
          return (
            <g key={valor}>
              <line x1={PADDING_IZQ} x2={ANCHO} y1={y} y2={y} stroke="#e1e0d9" strokeWidth={1} />
              <text x={0} y={y + 4} fontSize={10} fill={COLOR_TEXTO_MUTED}>
                {valor}%
              </text>
            </g>
          );
        })}
        <line x1={PADDING_IZQ} x2={ANCHO} y1={areaAlto} y2={areaAlto} stroke={COLOR_EJE} strokeWidth={1} />

        {serie.map((dia, i) => {
          const tieneDatos = dia.precision !== null;
          const alturaBarra = tieneDatos ? Math.max(2, (dia.precision as number) * areaAlto) : 3;
          const xBanda = PADDING_IZQ + i * anchoBanda;
          const x = xBanda + (anchoBanda - anchoBarra) / 2;
          const y = areaAlto - alturaBarra;
          const mostrarFecha = serie.length <= 10 || i % Math.ceil(serie.length / 7) === 0;

          return (
            <g key={dia.fecha} onMouseEnter={() => setHoverIndex(i)} onMouseLeave={() => setHoverIndex(null)}>
              <rect
                x={x}
                y={y}
                width={anchoBarra}
                height={alturaBarra}
                rx={4}
                fill={tieneDatos ? COLOR_DATO : COLOR_SIN_DATOS}
              />
              <rect x={x} y={0} width={anchoBarra} height={ALTO} fill="transparent" />
              {mostrarFecha && (
                <text
                  x={xBanda + anchoBanda / 2}
                  y={ALTO - 4}
                  fontSize={9}
                  textAnchor="middle"
                  fill={COLOR_TEXTO_MUTED}
                >
                  {dia.fecha.slice(5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {hoverIndex !== null && (
        <div
          className="pointer-events-none absolute rounded-md bg-slate-900 px-2 py-1 text-xs text-white shadow-lg"
          style={{
            left: `${((hoverIndex + 0.5) * anchoBanda + PADDING_IZQ) * (100 / ANCHO)}%`,
            top: 0,
            transform: "translate(-50%, -100%)",
          }}
        >
          <p className="font-medium">{serie[hoverIndex].fecha}</p>
          {serie[hoverIndex].intentos > 0 ? (
            <p>
              {serie[hoverIndex].aciertos}/{serie[hoverIndex].intentos} (
              {Math.round((serie[hoverIndex].precision as number) * 100)}%)
            </p>
          ) : (
            <p>Sin práctica</p>
          )}
        </div>
      )}
    </div>
  );
}
