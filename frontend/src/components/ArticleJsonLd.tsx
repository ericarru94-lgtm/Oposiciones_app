interface ArticleJsonLdProps {
  titulo: string;
  descripcion: string;
  ruta: string;
  fechaPublicacion: string;
}

/** Datos estructurados (schema.org/Article) de un artículo del blog — ver OrganizationJsonLd para el mismo patrón a nivel de sitio. */
export function ArticleJsonLd({ titulo, descripcion, ruta, fechaPublicacion }: ArticleJsonLdProps) {
  const datos = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: titulo,
    description: descripcion,
    url: `https://aprobox.es${ruta}`,
    datePublished: fechaPublicacion,
    inLanguage: "es",
    publisher: {
      "@type": "Organization",
      name: "Aprobox",
      logo: { "@type": "ImageObject", url: "https://aprobox.es/icons/icon-512.png" },
    },
  };

  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(datos) }} />;
}
