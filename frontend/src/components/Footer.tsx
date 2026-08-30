import { Link } from "react-router-dom";

const ENLACES = [
  { to: "/privacidad", label: "Privacidad" },
  { to: "/terminos", label: "Términos y condiciones" },
  { to: "/aviso-legal", label: "Aviso legal" },
  { to: "/cookies", label: "Cookies" },
  { to: "/contacto", label: "Contacto" },
];

/** Pie de página legal, consistente en toda la app (landing y área logueada). */
export function Footer() {
  return (
    <footer className="border-t border-line bg-card">
      <div className="mx-auto flex max-w-4xl flex-col items-center gap-3 px-6 py-8 text-sm text-muted sm:flex-row sm:justify-between">
        <span className="font-semibold text-ink">Aprobox</span>
        <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
          {ENLACES.map((enlace) => (
            <Link key={enlace.to} to={enlace.to} className="hover:text-ink">
              {enlace.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
