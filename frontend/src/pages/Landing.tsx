import { Link } from "react-router-dom";
import { Footer } from "../components/Footer";
import { NewsletterForm } from "../components/NewsletterForm";
import { ComparativaPlanes } from "../components/ComparativaPlanes";

const BENEFICIOS = [
  {
    icono: "✓",
    titulo: "Banco de preguntas verificadas",
    descripcion: "Cientos de preguntas revisadas una a una con su fuente legal, organizadas por tema oficial.",
  },
  {
    icono: "↻",
    titulo: "Repetición espaciada",
    descripcion: "Cada día te proponemos justo lo que te toca repasar, para que lo que aprendes no se olvide.",
  },
  {
    icono: "📊",
    titulo: "Progreso por tema",
    descripcion: "Ve de un vistazo en qué temas dominas el temario y en cuáles necesitas reforzar.",
  },
];

/** Pantalla pública en "/" para visitantes sin sesión iniciada. */
export function Landing() {
  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-white/10 bg-primary">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <span className="inline-flex items-center gap-1.5 font-semibold text-white">
            Aprobox
            <span aria-hidden className="h-2 w-2 rounded-full bg-success" />
            <span className="sr-only">Servicio activo</span>
          </span>
          <Link to="/login" className="text-sm text-white/80 hover:text-white">
            Iniciar sesión
          </Link>
        </div>
      </header>

      {/* Hero: bloque de color propio, con degradado hacia el fondo de la app para marcar el primer tramo del recorrido visual. */}
      <section className="bg-linear-to-b from-primary to-primary-hover px-6 pb-24 pt-20 text-center">
        <h1 className="text-4xl font-bold text-white sm:text-5xl">Aprobox</h1>
        <p className="mx-auto mt-4 max-w-xl text-lg text-white/85">
          Prepara la oposición de Auxiliar Administrativo del Estado con preguntas verificadas y un plan de repaso
          que se adapta a ti.
        </p>
        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            to="/onboarding"
            className="w-full rounded-full bg-accent px-9 py-4 text-center text-base font-bold text-white shadow-lg shadow-black/10 transition-transform hover:scale-[1.03] hover:bg-accent/90 sm:w-auto"
          >
            🚀 Empezar test gratis
          </Link>
          <Link
            to="/registro"
            className="w-full rounded-full border border-white/40 bg-white/10 px-9 py-4 text-center text-base font-semibold text-white backdrop-blur transition-colors hover:bg-white/20 sm:w-auto"
          >
            Crear cuenta
          </Link>
        </div>
        <p className="mt-4 text-xs text-white/70">Sin tarjeta, sin registro. Empiezas a practicar en 10 segundos.</p>
      </section>

      <main className="mx-auto max-w-4xl px-6">
        {/* Tarjetas de beneficios solapadas sobre el hero, para que el recorrido no salte en seco de un bloque plano al siguiente. */}
        <section className="-mt-14 grid grid-cols-1 gap-5 sm:grid-cols-3">
          {BENEFICIOS.map((beneficio) => (
            <div
              key={beneficio.titulo}
              className="rounded-2xl border border-line bg-card p-6 shadow-md shadow-ink/5 transition-transform hover:-translate-y-0.5"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-xl">
                {beneficio.icono}
              </div>
              <h2 className="mt-4 text-sm font-semibold text-ink">{beneficio.titulo}</h2>
              <p className="mt-2 text-sm text-muted">{beneficio.descripcion}</p>
            </div>
          ))}
        </section>

        <section className="my-20">
          <h2 className="text-center text-2xl font-bold text-ink">Elige tu plan</h2>
          <p className="mx-auto mt-2 max-w-md text-center text-sm text-muted">
            Empieza gratis. Pasa a premium cuando quieras practicar sin límite diario.
          </p>
          <div className="mt-8">
            <ComparativaPlanes />
          </div>
          <div className="mt-8 text-center">
            <Link
              to="/registro"
              className="inline-block rounded-full bg-accent px-8 py-3 text-sm font-bold text-white transition-colors hover:bg-accent/90"
            >
              Crear cuenta gratis
            </Link>
          </div>
        </section>

        <section className="mb-20 mx-auto max-w-md">
          <NewsletterForm />
        </section>
      </main>
      <Footer />
    </div>
  );
}
