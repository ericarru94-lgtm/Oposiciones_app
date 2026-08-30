import type { ReactNode } from "react";

/** Título de pantalla con más presencia: icono propio + tipografía reforzada, consistente en toda la app. */
export function PageTitle({ icono, children }: { icono: string; children: ReactNode }) {
  return (
    <h1 className="mb-6 flex items-center gap-3 text-3xl font-extrabold tracking-tight text-ink">
      <span aria-hidden className="text-3xl">
        {icono}
      </span>
      {children}
    </h1>
  );
}
