import Link from "next/link";
import { requireViewer } from "@/lib/auth/session";
import { getBudgetStatus } from "@/lib/data/budget";
import { listMissions } from "@/lib/data/missions";
import { TASK_STATUS_LABEL } from "@/lib/domain/status";
import { integrationStatus } from "@/lib/env";
import { MissionForm } from "./mission-form";

const usd = (v: number) => `${v.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} $`;

export default async function TasksPage() {
  const viewer = await requireViewer();
  const [missions, budget] = await Promise.all([listMissions(viewer), getBudgetStatus(viewer)]);
  const claude = integrationStatus().find((i) => i.id === "anthropic")?.configured ?? false;
  const reason =
    viewer.mode !== "admin" ? "Conecta Supabase para crear encargos."
    : !claude ? "Falta la clave de Anthropic en el servidor."
    : budget?.exceeded ? "Se ha alcanzado el límite mensual de gasto en IA."
    : null;

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs uppercase tracking-[0.18em] text-cobalt-soft">Piloto · Alex, Marcus y Sofia</p>
        <h1 className="mt-2 font-display text-3xl font-semibold">Encargos</h1>
        <p className="mt-2 text-sm text-muted">
          Alex planifica y delega; Marcus investiga con fuentes; Sofia prepara la estrategia. Todo queda en borrador: nadie contacta, publica ni gasta fuera de los límites.
        </p>
      </div>

      <section className="rounded-2xl border border-line bg-surface p-5">
        <h2 className="font-display font-semibold">Nuevo encargo</h2>
        {budget && (
          <p className="mt-1 text-xs text-muted">
            Gastado o reservado este mes: {usd(budget.monthSpentUsd)} de {budget.monthlyLimitUsd === null ? "sin límite" : usd(budget.monthlyLimitUsd)} · por misión{" "}
            {budget.missionLimitUsd === null ? "sin límite" : usd(budget.missionLimitUsd)} · por tarea {budget.taskLimitUsd === null ? "sin límite" : usd(budget.taskLimitUsd)} · máx. 5 empresas
          </p>
        )}
        <div className="mt-4">
          <MissionForm disabled={reason !== null} reason={reason} />
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-5">
        <h2 className="font-display font-semibold">Historial</h2>
        {missions.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Todavía no hay encargos.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {missions.map((m) => (
              <li key={m.id}>
                <Link href={`/tareas/${m.id}`} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm hover:text-cobalt-soft">
                  <span className="min-w-0 flex-1 truncate">{m.title}</span>
                  <span className="text-xs text-muted">
                    {TASK_STATUS_LABEL[m.status]} · {usd(m.costUsd)} · {new Date(m.createdAt).toLocaleDateString("es-ES")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
