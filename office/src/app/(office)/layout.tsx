import { signOut } from "@/app/actions/auth";
import { OfficeLogo } from "@/components/logo";
import { BottomNav, SideNav } from "@/components/nav-links";
import { requireViewer } from "@/lib/auth/session";

export default async function OfficeLayout({ children }: LayoutProps<"/">) {
  const viewer = await requireViewer();
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[256px_1fr]">
      <aside className="hidden border-r border-white/5 bg-gradient-to-b from-surface to-ink p-5 lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:gap-8">
        <OfficeLogo />
        <SideNav />
        <div className="mt-auto space-y-3 text-xs text-muted">
          {viewer.mode === "admin" ? (
            <>
              <p className="truncate">{viewer.email}</p>
              <form action={signOut}>
                <button className="underline hover:text-paper">Cerrar sesión</button>
              </form>
            </>
          ) : (
            <p>Vista previa local</p>
          )}
        </div>
      </aside>
      <div className="min-w-0 pb-20 lg:pb-0">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-white/5 bg-ink/85 px-4 py-2.5 backdrop-blur-xl lg:hidden">
          <OfficeLogo />
          {viewer.mode === "admin" && (
            <form action={signOut}>
              <button className="text-xs text-muted underline">Salir</button>
            </form>
          )}
        </header>
        {viewer.mode === "local-preview" && (
          <div className="border-b border-signal/20 bg-signal/[0.07] px-4 py-2 text-xs text-signal/90 lg:px-8">
            Vista previa local sin base de datos: se muestra la configuración real de los agentes, pero no hay
            tareas, memoria ni acciones. Conecta Supabase para usar la oficina.
          </div>
        )}
        <main className="mx-auto max-w-7xl px-4 py-5 lg:px-8 lg:py-8">{children}</main>
      </div>
      <BottomNav />
    </div>
  );
}
