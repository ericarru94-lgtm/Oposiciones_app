export function PasoBienvenida({ onEmpezar }: { onEmpezar: () => void }) {
  return (
    <div className="mx-auto max-w-lg rounded-2xl bg-white p-8 text-center shadow-sm">
      <h1 className="text-2xl font-bold text-slate-900">Prepara tu oposición de Auxiliar Administrativo</h1>
      <p className="mt-3 text-slate-600">
        Empieza con un mini-test de 5 preguntas, sin registrarte, para que veas cómo funciona antes de crear tu
        cuenta.
      </p>
      <button
        onClick={onEmpezar}
        className="mt-6 w-full rounded-lg bg-indigo-600 px-4 py-3 font-medium text-white hover:bg-indigo-700"
      >
        Empezar mini-test
      </button>
    </div>
  );
}
