import { Upcoming } from "@/components/upcoming";
import { requireViewer } from "@/lib/auth/session";

export default async function Page() {
  await requireViewer();
  return (
    <Upcoming
      href="/centro"
      points={["Actividad de todos los agentes", "Tareas pendientes y en ejecución", "Aprobaciones pendientes", "Errores", "Coste real de IA", "Actividad reciente"]}
    />
  );
}
