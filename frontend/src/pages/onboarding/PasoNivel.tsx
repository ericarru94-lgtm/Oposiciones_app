const NIVELES = [
  { valor: "cero", icono: "🌱", titulo: "Empiezo de cero", descripcion: "Todavía no he estudiado nada del temario." },
  { valor: "en_progreso", icono: "📖", titulo: "Ya llevo tiempo", descripcion: "Llevo un tiempo estudiando el temario." },
  { valor: "repito", icono: "🎯", titulo: "Repito examen", descripcion: "Ya me he presentado antes a esta oposición." },
];

export function PasoNivel({ onElegir }: { onElegir: (nivel: string) => void }) {
  return (
    <div className="mx-auto max-w-lg rounded-3xl bg-card p-8 shadow-sm">
      <h2 className="flex items-center gap-2 text-xl font-extrabold tracking-tight text-ink">
        <span aria-hidden>👋</span> ¿Cómo empiezas?
      </h2>
      <p className="mt-1 text-sm text-muted">Así adaptamos tu plan de repaso desde el primer día.</p>
      <div className="mt-6 space-y-3">
        {NIVELES.map((nivel) => (
          <button
            key={nivel.valor}
            onClick={() => onElegir(nivel.valor)}
            className="flex w-full items-center gap-4 rounded-xl border border-line px-4 py-4 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-xl">
              {nivel.icono}
            </span>
            <div>
              <p className="font-semibold text-ink">{nivel.titulo}</p>
              <p className="text-sm text-muted">{nivel.descripcion}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
