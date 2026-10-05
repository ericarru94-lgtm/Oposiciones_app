import { Link, useParams } from "react-router-dom";
import { PublicContentLayout } from "../components/PublicContentLayout";
import { Card } from "../components/Card";
import { PageTitle } from "../components/PageTitle";
import { EsquemaResumen } from "../components/EsquemaResumen";
import { ArticleJsonLd } from "../components/ArticleJsonLd";
import { useSeo } from "../hooks/useSeo";
import { obtenerEntradaBlog } from "../content/blog";

export function BlogPost() {
  const { slug } = useParams<{ slug: string }>();
  const entrada = slug ? obtenerEntradaBlog(slug) : undefined;

  useSeo({
    titulo: entrada?.titulo ?? "Artículo no encontrado",
    descripcion: entrada?.descripcion ?? "",
    ruta: `/blog/${slug ?? ""}`,
    tipo: "article",
    noIndexar: !entrada,
  });

  if (!entrada) {
    return (
      <PublicContentLayout>
        <PageTitle icono="✍️">Artículo no encontrado</PageTitle>
        <p className="text-sm text-muted">Puede que el enlace esté roto o el artículo ya no exista.</p>
        <Link to="/blog" className="mt-4 inline-block text-sm font-medium text-primary hover:underline">
          Volver al blog
        </Link>
      </PublicContentLayout>
    );
  }

  return (
    <PublicContentLayout>
      <ArticleJsonLd
        titulo={entrada.titulo}
        descripcion={entrada.descripcion}
        ruta={`/blog/${entrada.slug}`}
        fechaPublicacion={entrada.fechaPublicacion}
      />
      <PageTitle icono="✍️">{entrada.titulo}</PageTitle>

      <Card>
        <EsquemaResumen texto={entrada.cuerpo} />
      </Card>

      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          to="/temario"
          className="rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-hover"
        >
          Ver el temario completo
        </Link>
        <Link
          to="/onboarding"
          className="rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-ink hover:bg-canvas"
        >
          Empezar test gratis
        </Link>
        <Link to="/blog" className="rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-muted hover:bg-canvas">
          Volver al blog
        </Link>
      </div>
    </PublicContentLayout>
  );
}
