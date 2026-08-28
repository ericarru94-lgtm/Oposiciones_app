export function RachaBadge({ dias }: { dias: number }) {
  return (
    <div className="flex items-center gap-2 rounded-full bg-accent/10 px-3 py-1.5 text-sm font-medium text-accent">
      <svg width={14} height={14} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M12 2c1 3-3 4-3 8a3 3 0 0 0 6 0c0-1-.5-2-1-2 1.5 1 3 3 3 5.5A5.5 5.5 0 0 1 11.5 19 5.5 5.5 0 0 1 6 13.5C6 9 12 7 12 2Z" />
      </svg>
      <span>
        {dias} {dias === 1 ? "día" : "días"} seguidos
      </span>
    </div>
  );
}
