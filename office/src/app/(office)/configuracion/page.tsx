import { APPROVAL_REQUIRED_RISKS, RISK_LABEL } from "@/lib/agents/permissions";
import { MODELS } from "@/lib/agents/registry";
import { requireViewer } from "@/lib/auth/session";
import { listAgents } from "@/lib/data/agents";
import { getBudgetStatus } from "@/lib/data/budget";
import { defaultModel, integrationStatus, readEnv } from "@/lib/env";
import { LimitsForm } from "./limits-form";

export default async function SettingsPage() {
  const viewer = await requireViewer();
  const env = readEnv();
  const integrations = integrationStatus(env);
  const [agents, budget] = await Promise.all([listAgents(viewer), getBudgetStatus(viewer)]);
  const usd = (v: number) => `${v.toLocaleString("es-ES", { maximumFractionDigits: 2 })} $`;

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs uppercase tracking-[0.18em] text-cobalt-soft">Configuración</p>
        <h1 className="mt-2 font-display text-3xl font-semibold">Ajustes de la oficina</h1>
        <p className="mt-2 text-sm text-muted">
          Las claves se guardan solo en variables de entorno del servidor. Aquí solo se muestra si están configuradas.
        </p>
      </div>

      <section className="rounded-2xl bg-surface/80 ring-1 ring-white/5 p-5">
        <h2 className="font-display font-semibold">Integraciones</h2>
        <ul className="mt-4 divide-y divide-line">
          {integrations.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
              <div>
                <p>{i.name}</p>
                <p className="text-xs text-muted">{i.detail}</p>
              </div>
              <span
                className={`rounded-full px-2.5 py-1 text-xs ${
                  i.configured ? "bg-online/15 text-online" : i.required ? "bg-signal/15 text-signal" : "bg-panel text-muted"
                }`}
              >
                {i.configured ? "Configurado" : i.required ? "Pendiente" : "Opcional · pendiente"}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl bg-surface/80 ring-1 ring-white/5 p-5">
        <h2 className="font-display font-semibold">Modelo por agente</h2>
        <p className="mt-1 text-xs text-muted">
          Modelo por defecto: {MODELS[defaultModel(env)].label}. El cambio desde aquí se activa en la fase 3.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-2 pr-4 font-normal">Empleado</th>
                <th className="py-2 pr-4 font-normal">Modelo</th>
                <th className="py-2 font-normal">Precio (entrada / salida por millón de tokens)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {agents.map((a) => {
                const m = MODELS[a.state.model];
                return (
                  <tr key={a.id}>
                    <td className="py-2 pr-4">{a.name}</td>
                    <td className="py-2 pr-4">{m.label}</td>
                    <td className="py-2 text-muted">
                      {m.inputUsdPerMTok} $ / {m.outputUsdPerMTok} $
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <div className="rounded-2xl bg-surface/80 ring-1 ring-white/5 p-5">
          <h2 className="font-display font-semibold">Límites de gasto de IA</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">Gastado este mes</dt>
              <dd>{budget ? usd(budget.monthSpentUsd) : "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Estado</dt>
              <dd className={budget?.exceeded ? "text-signal" : "text-online"}>
                {budget ? (budget.exceeded ? "Límite alcanzado: agentes parados" : "Dentro del límite") : "—"}
              </dd>
            </div>
          </dl>
          <LimitsForm monthly={budget?.monthlyLimitUsd ?? null} task={budget?.taskLimitUsd ?? null} mission={budget?.missionLimitUsd ?? null} disabled={!budget} />
          <p className="mt-3 text-xs text-muted">
            Al llegar al límite mensual, el motor deja de empezar o continuar tareas. El límite por tarea corta una
            ejecución cuando la supera. Fija también un tope en la consola de Anthropic.
          </p>
        </div>
        <div className="rounded-2xl bg-surface/80 ring-1 ring-white/5 p-5">
          <h2 className="font-display font-semibold">Siempre requieren tu aprobación</h2>
          <ul className="mt-3 space-y-1 text-sm">
            {APPROVAL_REQUIRED_RISKS.map((r) => (
              <li key={r}>· {RISK_LABEL[r]}</li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">
            Enviar emails, contactar clientes, publicar, lanzar campañas, gastar dinero, tocar producción y borrar
            datos. Esta regla está en el código y en las instrucciones de cada agente.
          </p>
        </div>
      </section>
    </div>
  );
}
