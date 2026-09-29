import { Link } from "react-router-dom";
import { PublicContentLayout } from "../components/PublicContentLayout";
import { PageTitle } from "../components/PageTitle";
import { useSeo } from "../hooks/useSeo";
import { ENTRADAS_BLOG } from "../content/blog";

/** Índice público de artículos del blog (guías de oposición), ver content/blog.ts. */
export function Blog() {
  useSeo({
    titulo: "Blog de oposiciones — Auxiliar Administrativo del Estado",
    descripcion:
      "Guías sobre la oposición de Auxiliar Administrativo del Estado: temario, requisitos, sueldo y cómo organizar el estudio.",
    ruta: "/blog",
  });

  return (
    <PublicContentLayout>
      <PageTitle icono="✍️">Blog</PageTitle>
      <p className="text-sm text-muted">Guías sobre la oposición de Auxiliar Administrativo del Estado.</p>

      <ul className="mt-6 space-y-4">
        {ENTRADAS_BLOG.map((entrada) => (
          <li key={entrada.slug}>
            <Link
              to={`/blog/${entrada.slug}`}
              className="block rounded-2xl border border-line bg-card p-5 hover:border-primary hover:bg-canvas"
            >
              <h2 className="text-base font-semibold text-ink">{entrada.titulo}</h2>
              <p className="mt-1.5 text-sm text-muted">{entrada.descripcion}</p>
            </Link>
          </li>
        ))}
      </ul>
    </PublicContentLayout>
  );
}
