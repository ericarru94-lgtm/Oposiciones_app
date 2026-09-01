import type { ProgresoComunidad } from "../api/types";

interface Props {
  comunidad: ProgresoComunidad | null;
}

function Barra({ etiqueta, propio, media, formatear }: { etiqueta: string; propio: number; media: number; formatear: (n: number) => string }) {
  const max = Math.max(propio, media, 1);
  return (
    <div>
      <div className="flex items-center justify-between text-xs text-muted">
        <span>{etiqueta}</span>
        <span>
          Tú: <span className="font-semibold text-ink">{formatear(propio)}</span> · Media:{" "}
          <span className="font-semibold text-ink">{formatear(media)}</span>
        </span>
      </div>
      <div className="mt-2 space-y-1.5">
        <div className="h-2 w-full overflow-hidden rounded-full bg-line">
          <div className="h-full rounded-full bg-primary" style={{ width: `${(propio / max) * 100}%` }} />
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-line">
          <div className="h-full rounded-full bg-muted/50" style={{ width: `${(media / max) * 100}%` }} />
        </div>
      </div>
    </div>
  );
}

/**
 * Comparativa anónima con el resto de usuarios (racha y % de acierto): solo
 * agregados, nunca un dato por usuario ni un nombre. Se oculta del todo si
 * el backend indica que la muestra es demasiado pequeña para comparar sin
 * acercarse a identificar a alguien (ver MUESTRA_MINIMA_COMUNIDAD en
 * backend/src/routes/progreso.ts).
 */
export function ComunidadComparativa({ comunidad }: Props) {
  if (!comunidad) return null;

  if (!comunidad.disponible) {
    return (
      <section className="mb-8 rounded-2xl border border-line bg-card p-5">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink">
          <span aria-hidden>👥</span> Comparativa con la comunidad
        </h2>
        <p className="text-sm text-muted">
          Todavía no hay suficientes usuarios activos para comparar sin comprometer el anonimato de nadie. Vuelve a
          mirarlo más adelante.
        </p>
      </section>
    );
  }

  const { propia, media } = comunidad;
  if (!media) return null;

  return (
    <section className="mb-8 rounded-2xl border border-line bg-card p-5">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink">
        <span aria-hidden>👥</span> Comparativa con la comunidad
      </h2>
      <p className="mb-4 text-xs text-muted">
        Tu racha y tu % de acierto frente a la media de otros {comunidad.usuariosComparados} usuarios de Aprobox —
        sin nombres ni datos individuales, solo como referencia.
      </p>

      <div className="space-y-5">
        <Barra
          etiqueta="🔥 Racha (días)"
          propio={propia.racha}
          media={media.racha}
          formatear={(n) => `${Math.round(n * 10) / 10}`}
        />
        {propia.precision !== null && media.precision !== null && (
          <Barra
            etiqueta="🎯 % de acierto"
            propio={propia.precision * 100}
            media={media.precision * 100}
            formatear={(n) => `${Math.round(n)}%`}
          />
        )}
      </div>
    </section>
  );
}
