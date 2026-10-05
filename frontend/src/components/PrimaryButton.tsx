import type { ButtonHTMLAttributes } from "react";

/**
 * Botón primario de ancho completo (`w-full rounded-xl bg-primary px-4
 * py-3 font-medium text-white hover:bg-primary-hover`), repetido en 10
 * sitios de 7 archivos. Cada sitio variaba en detalles menores (tamaño de
 * texto, transición, el estilo exacto de `disabled`, el margen superior) —
 * esos matices se pasan tal cual por `className` para no cambiar nada
 * visualmente, en vez de forzarlos a un único estilo.
 */
export function PrimaryButton({ className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={["w-full rounded-xl bg-primary px-4 py-3 font-medium text-white hover:bg-primary-hover", className]
        .filter(Boolean)
        .join(" ")}
    />
  );
}
