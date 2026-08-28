import { Link } from "react-router-dom";

const BENEFICIOS = [
  {
    titulo: "Banco de preguntas verificadas",
    descripcion: "Cientos de preguntas revisadas una a una con su fuente legal, organizadas por tema oficial.",
  },
  {
    titulo: "Repetición espaciada",
    descripcion: "Cada día te proponemos justo lo que te toca repasar, para que lo que aprendes no se olvide.",
  },
  {
    titulo: "Progreso por tema",
    descripcion: "Ve de un vistazo en qué temas dominas el temario y en cuáles necesitas reforzar.",
  },
];

/** Pantalla pública en "/" para visitantes sin sesión iniciada. */
export function Landing() {
  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line bg-card">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <span className="font-semibold text-ink">Aprobox</span>
          <Link to="/login" className="text-sm text-muted hover:text-ink">
            Iniciar sesión
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-16">
        <section className="text-center">
          <h1 className="text-4xl font-bold text-ink sm:text-5xl">Aprobox</h1>
          <p className="mx-auto mt-4 max-w-xl text-lg text-muted">
            Prepara la oposición de Auxiliar Administrativo del Estado con preguntas verificadas y un plan de repaso
            que se adapta a ti.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              to="/onboarding"
              className="w-full rounded-full bg-primary px-8 py-3 text-center font-semibold text-white transition-colors hover:bg-primary-hover sm:w-auto"
            >
              Empezar test gratis
            </Link>
            <Link
              to="/registro"
              className="w-full rounded-full border border-line bg-card px-8 py-3 text-center font-semibold text-ink transition-colors hover:border-primary/40 sm:w-auto"
            >
              Crear cuenta
            </Link>
          </div>
        </section>

        <section className="mt-20 grid grid-cols-1 gap-6 sm:grid-cols-3">
          {BENEFICIOS.map((beneficio) => (
            <div key={beneficio.titulo} className="rounded-2xl border border-line bg-card p-6">
              <h2 className="text-sm font-semibold text-ink">{beneficio.titulo}</h2>
              <p className="mt-2 text-sm text-muted">{beneficio.descripcion}</p>
            </div>
          ))}
        </section>

        <section className="mt-16 rounded-2xl border border-line bg-card p-8 text-center">
          <p className="text-sm font-medium text-muted">Plan Premium</p>
          <p className="mt-1 text-2xl font-bold text-ink">4,99€/mes</p>
          <p className="mt-2 text-sm text-muted">
            Preguntas ilimitadas y repaso por repetición espaciada sin restricciones del límite diario.
          </p>
        </section>
      </main>
    </div>
  );
}
