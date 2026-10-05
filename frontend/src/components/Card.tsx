import type { ReactNode } from "react";

/**
 * Contenedor "tarjeta blanca" (rounded-2xl border border-line bg-card p-6),
 * el estilo base repetido antes en 8 páginas/componentes. `className` se
 * añade a los modificadores propios de cada sitio (hover, centrado,
 * sombra...), nunca los sustituye.
 */
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={["rounded-2xl border border-line bg-card p-6", className].filter(Boolean).join(" ")}>{children}</div>;
}
