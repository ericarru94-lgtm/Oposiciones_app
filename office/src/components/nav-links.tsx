"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { NAV } from "@/lib/navigation";

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" || pathname.startsWith("/empleados") : pathname.startsWith(href);
}

const svg = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" className="size-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {d}
  </svg>
);

/** Iconos de trazo fino, en la línea del monograma de la marca. */
const ICONS: Record<string, ReactNode> = {
  "/": svg(<><path d="M3 10.5L12 4l9 6.5" /><path d="M5 9.5V20h14V9.5" /><path d="M9.5 20v-5h5v5" /></>),
  "/centro": svg(<><circle cx="12" cy="12" r="8" /><path d="M12 12l4-3" /><path d="M12 4v2M20 12h-2M4 12h2" /></>),
  "/tareas": svg(<><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4h6v3H9zM9 12l2 2 4-4M9 17h6" /></>),
  "/reuniones": svg(<><ellipse cx="12" cy="13" rx="7" ry="4" /><path d="M5 13v2c0 2.2 3.1 4 7 4s7-1.8 7-4v-2" /><circle cx="12" cy="6" r="1.6" /></>),
  "/crm": svg(<><circle cx="9" cy="9" r="3" /><path d="M3.5 19c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5" /><path d="M16 7h5M16 11h5M18 15h3" /></>),
  "/configuracion": svg(<><circle cx="12" cy="12" r="3" /><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" /></>),
};

export function SideNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Secciones">
      {NAV.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
              active ? "bg-cobalt/15 text-paper" : "text-muted hover:bg-white/[0.04] hover:text-paper"
            }`}
          >
            {active && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-cobalt-soft" />}
            <span className={active ? "text-cobalt-soft" : "text-muted group-hover:text-paper"}>{ICONS[item.href]}</span>
            <span className="flex-1 truncate">{item.label}</span>
            {item.phase > 1 && <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] text-muted" title={`Disponible en la fase ${item.phase}`}>F{item.phase}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Secciones"
      className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-6 border-t border-white/5 bg-ink/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
    >
      {NAV.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex flex-col items-center gap-1 pb-2 pt-2.5 text-[10px] font-medium transition-colors ${active ? "text-cobalt-soft" : "text-muted"}`}
          >
            {ICONS[item.href]}
            {item.short}
          </Link>
        );
      })}
    </nav>
  );
}
