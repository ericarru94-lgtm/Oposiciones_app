import { NAV } from "@/lib/navigation";

/** Sección planificada: se dice claramente que aún no funciona. */
export function Upcoming({ href, points }: { href: string; points: string[] }) {
  const item = NAV.find((n) => n.href === href)!;
  return (
    <section>
      <p className="text-xs uppercase tracking-[0.18em] text-cobalt-soft">Fase {item.phase}</p>
      <h1 className="mt-2 font-display text-3xl font-semibold">{item.label}</h1>
      <p className="mt-3 max-w-xl text-muted">
        Esta sección todavía no está construida. No muestra datos simulados: se activará con datos reales en la
        fase {item.phase}.
      </p>
      <ul className="mt-6 grid gap-2 sm:grid-cols-2">
        {points.map((p) => (
          <li key={p} className="rounded-xl border border-line bg-surface px-4 py-3 text-sm">
            {p}
          </li>
        ))}
      </ul>
    </section>
  );
}
