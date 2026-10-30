import { Upcoming } from "@/components/upcoming";

export default function Page() {
  return (
    <Upcoming
      href="/tareas"
      points={["Kanban: Pendiente → Asignada → En proceso → En revisión → Requiere aprobación → Completada / Fallida", "Filtros por agente, departamento, prioridad y fecha", "Asignar tareas a cualquier empleado", "Reintentos controlados"]}
    />
  );
}
