/**
 * Refleja únicamente diferenciación real entre planes que existe hoy en el
 * código (ver backend/src/lib/dailyLimit.ts y routes/preguntas.ts): el
 * límite diario de preguntas es lo único que de verdad distingue Gratis de
 * Premium — el simulacro y las estadísticas por tema están disponibles
 * para cualquier usuario registrado, con o sin plan premium.
 */
const CARACTERISTICAS: { texto: string; gratis: boolean; premium: boolean }[] = [
  { texto: "Banco de preguntas verificadas por tema", gratis: true, premium: true },
  { texto: "Repaso por repetición espaciada (SM-2)", gratis: true, premium: true },
  { texto: "Simulacros de examen cronometrados", gratis: true, premium: true },
  { texto: "Progreso y estadísticas por tema", gratis: true, premium: true },
  { texto: "Preguntas de práctica ilimitadas cada día", gratis: false, premium: true },
  { texto: "Repasar hoy sin límite diario", gratis: false, premium: true },
];

function Marca({ incluido }: { incluido: boolean }) {
  return incluido ? (
    <span aria-label="Incluido" className="text-success">
      ✅
    </span>
  ) : (
    <span aria-label="No incluido" className="text-muted/50">
      ❌
    </span>
  );
}

export function ComparativaPlanes() {
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
      <div className="rounded-2xl border border-line bg-card p-6">
        <p className="text-sm font-semibold text-ink">Gratis</p>
        <p className="mt-1 text-3xl font-bold text-ink">0€</p>
        <p className="mt-1 text-sm text-muted">Para empezar a practicar sin compromiso.</p>
        <ul className="mt-5 space-y-3">
          {CARACTERISTICAS.map((c) => (
            <li key={c.texto} className="flex items-center gap-3 text-sm text-ink">
              <Marca incluido={c.gratis} />
              {c.texto}
            </li>
          ))}
        </ul>
      </div>

      <div className="relative overflow-hidden rounded-2xl border-2 border-accent bg-ink p-6 text-white">
        <span className="absolute right-5 top-5 rounded-full bg-accent px-3 py-1 text-xs font-bold text-white">
          Recomendado
        </span>
        <p className="text-sm font-semibold text-accent">Premium</p>
        <p className="mt-1 text-3xl font-bold text-white">4,99€/mes</p>
        <p className="mt-1 text-sm text-white/70">Practica sin restricciones mientras dure tu preparación.</p>
        <ul className="mt-5 space-y-3">
          {CARACTERISTICAS.map((c) => (
            <li key={c.texto} className="flex items-center gap-3 text-sm text-white">
              <Marca incluido={c.premium} />
              {c.texto}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
