// Marca de la oficina: monograma «HE» de trazo fino con el punto de señal.
export function OfficeLogo({ className = "" }: { className?: string }) {
  return (
    <span className={`flex items-center gap-3 ${className}`}>
      <svg viewBox="0 0 40 40" className="size-9" aria-hidden>
        <rect width={40} height={40} rx={10} fill="#2747f5" />
        <g stroke="white" strokeWidth={2} fill="none" strokeLinecap="round">
          <path d="M10 11v18M10 20h9M19 11v18M25 11v18h7M25 20h6M25 11h7" />
        </g>
        <circle cx={32} cy={29} r={2.6} fill="#ff4b2b" />
      </svg>
      <span className="leading-tight">
        <span className="block font-display text-sm font-semibold tracking-tight">HE Signal</span>
        <span className="block text-[11px] uppercase tracking-[0.18em] text-muted">AI Office</span>
      </span>
    </span>
  );
}
