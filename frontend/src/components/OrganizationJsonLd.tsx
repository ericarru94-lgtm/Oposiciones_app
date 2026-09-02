/**
 * Datos estructurados (schema.org) básicos de la landing: Organization +
 * WebSite, para que Google pueda mostrar el nombre/logo de Aprobox de
 * forma más rica en resultados de búsqueda. Solo se renderiza en "/" —
 * no tiene sentido repetirlo en cada página pública.
 */
export function OrganizationJsonLd() {
  const datos = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        name: "Aprobox",
        url: "https://aprobox.es",
        logo: "https://aprobox.es/icons/icon-512.png",
      },
      {
        "@type": "WebSite",
        name: "Aprobox",
        url: "https://aprobox.es",
        inLanguage: "es",
      },
    ],
  };

  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(datos) }} />;
}
