"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV } from "@/lib/navigation";

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" || pathname.startsWith("/empleados") : pathname.startsWith(href);
}

export function SideNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1" aria-label="Secciones">
      {NAV.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${
              active ? "bg-cobalt text-white" : "text-muted hover:bg-panel hover:text-paper"
            }`}
          >
            {item.label}
            {item.phase > 1 && (
              <span className={`text-[10px] ${active ? "text-white/70" : "text-muted/70"}`}>F{item.phase}</span>
            )}
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
      className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-6 border-t border-line bg-surface/95 backdrop-blur lg:hidden"
    >
      {NAV.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`py-3 text-center text-[11px] ${active ? "text-cobalt-soft" : "text-muted"}`}
          >
            {item.short}
          </Link>
        );
      })}
    </nav>
  );
}
