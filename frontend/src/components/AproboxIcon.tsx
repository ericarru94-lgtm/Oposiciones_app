/**
 * Icono de marca: "A" blanca sobre cuadrado redondeado índigo, con una
 * insignia de check en ámbar — la misma marca que public/favicon.svg (y el
 * resto de iconos de public/icons/), para que la landing y la pestaña del
 * navegador usen exactamente el mismo símbolo. Vectorial a propósito para
 * verse nítido a cualquier tamaño (ver `size`).
 */
export function AproboxIcon({ size = 72, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Aprobox"
      className={className}
    >
      <rect width="100" height="100" rx="24" fill="#4338ca" />
      <path
        d="M50 14 L86 86 L14 86 Z M50 32 L68 60 L32 60 Z"
        fill="#ffffff"
        fillRule="evenodd"
        clipRule="evenodd"
      />
      <circle cx="73" cy="77" r="22" fill="#4338ca" />
      <circle cx="73" cy="77" r="18" fill="#f59e0b" />
      <path
        d="M65.5 77.5 L71 83 L81.5 70"
        stroke="#ffffff"
        strokeWidth="5.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
