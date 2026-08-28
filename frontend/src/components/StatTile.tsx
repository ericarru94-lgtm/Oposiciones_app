import type { ReactNode } from "react";

export function StatTile({ icono, label, valor }: { icono: ReactNode; label: string; valor: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-card p-4">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-base">{icono}</div>
      <p className="mt-3 text-xs text-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold text-ink">{valor}</p>
    </div>
  );
}
