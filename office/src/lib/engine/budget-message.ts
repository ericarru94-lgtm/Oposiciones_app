// Mensaje de parada por presupuesto con cifras reales. Nunca dice que se ha
// agotado un límite si lo que no cabe es la reserva de la siguiente llamada.

import type { BudgetSnapshot } from "./store";

export type BudgetStopReason = "monthly_budget" | "mission_budget" | "task_budget";

const usd = (v: number) => `${v.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} $`;

export function budgetStopMessage(reason: BudgetStopReason, nextReserveUsd: number, s: BudgetSnapshot, isSubtask: boolean): string {
  const scope = reason === "monthly_budget" ? "month" : reason === "mission_budget" ? "mission" : "task";
  const nominal = reason === "monthly_budget" ? s.limits.monthly : reason === "mission_budget" ? s.limits.mission : s.limits.task;
  // Las subtareas no pueden usar la parte reservada al informe del coordinador.
  const usable = nominal === null ? null : reason === "mission_budget" && isSubtask ? nominal - s.limits.synthesisReserve : nominal;
  const real = s.real[scope];
  const open = s.open[scope];
  const uncertain = s.uncertain[scope];
  const available = usable === null ? null : Math.max(0, usable - real - open - uncertain);
  const name = reason === "monthly_budget" ? "mensual" : reason === "mission_budget" ? "de la misión" : "por tarea";
  const limitText =
    nominal === null
      ? "sin límite"
      : reason === "mission_budget" && isSubtask
        ? `${usd(nominal)}, de los que ${usd(s.limits.synthesisReserve)} quedan reservados para el informe de Alex`
        : usd(nominal);
  return [
    `Tarea detenida: la siguiente llamada no cabe en el límite ${name} (${limitText}).`,
    `Reserva necesaria para la siguiente llamada: ${usd(nextReserveUsd)}.`,
    `Gasto real acumulado: ${usd(real)} · reservas abiertas: ${usd(open)} · reservas inciertas: ${usd(uncertain)}.`,
    available === null ? "" : `Saldo disponible: ${usd(available)}.`,
    available !== null && available > 0
      ? "El límite no se ha gastado entero: lo que no cabe es la reserva prudente de la siguiente llamada."
      : "El límite está comprometido por completo (gasto real más reservas).",
  ]
    .filter(Boolean)
    .join(" ");
}
