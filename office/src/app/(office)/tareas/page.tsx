import { Upcoming } from "@/components/upcoming";
import { requireViewer } from "@/lib/auth/session";

export default async function Page() {
  await requireViewer();
  return (
    <Upcoming
      href="/tareas"
      points={["Kanban: Pendiente → Asignada → En proceso → En revisión → Requiere aprobación → Completada / Fallida", "Filtros por agente, departamento, prioridad y fecha", "Asignar tareas a cualquier empleado", "Reintentos controlados"]}
    />
  );
}
