import { PaginaEstatica } from "../components/PaginaEstatica";

export function Contacto() {
  return (
    <PaginaEstatica icono="✉️" titulo="Contacto">
      <p>
        ¿Tienes dudas, sugerencias o has encontrado una pregunta con un error? Escríbenos o llámanos — te
        respondemos lo antes posible.
      </p>

      <div className="mt-6 space-y-4">
        <a
          href="tel:623976145"
          className="flex items-center gap-4 rounded-xl border border-line bg-canvas p-4 transition-colors hover:border-primary/40"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-xl">
            📞
          </span>
          <div>
            <p className="text-xs text-muted">Teléfono</p>
            <p className="font-semibold text-ink">623 976 145</p>
          </div>
        </a>

        <a
          href="mailto:aprobox@gmail.com"
          className="flex items-center gap-4 rounded-xl border border-line bg-canvas p-4 transition-colors hover:border-primary/40"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-xl">
            ✉️
          </span>
          <div>
            <p className="text-xs text-muted">Email</p>
            <p className="font-semibold text-ink">aprobox@gmail.com</p>
          </div>
        </a>
      </div>
    </PaginaEstatica>
  );
}
