const NIVELES = [
  { valor: "cero", titulo: "Empiezo de cero", descripcion: "Todavía no he estudiado nada del temario." },
  { valor: "en_progreso", titulo: "Ya llevo tiempo", descripcion: "Llevo un tiempo estudiando el temario." },
  { valor: "repito", titulo: "Repito examen", descripcion: "Ya me he presentado antes a esta oposición." },
];

export function PasoNivel({ onElegir }: { onElegir: (nivel: string) => void }) {
  return (
    <div className="mx-auto max-w-lg rounded-2xl bg-white p-8 shadow-sm">
      <h2 className="text-xl font-semibold text-slate-900">¿Cómo empiezas?</h2>
      <p className="mt-1 text-sm text-slate-500">Así te preparamos un primer test a tu medida.</p>
      <div className="mt-5 space-y-3">
        {NIVELES.map((nivel) => (
          <button
            key={nivel.valor}
            onClick={() => onElegir(nivel.valor)}
            className="w-full rounded-lg border border-slate-200 px-4 py-3 text-left hover:border-indigo-400 hover:bg-indigo-50"
          >
            <p className="font-medium text-slate-900">{nivel.titulo}</p>
            <p className="text-sm text-slate-500">{nivel.descripcion}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
