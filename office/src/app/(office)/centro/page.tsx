import { Upcoming } from "@/components/upcoming";

export default function Page() {
  return (
    <Upcoming
      href="/centro"
      points={["Actividad de todos los agentes", "Tareas pendientes y en ejecución", "Aprobaciones pendientes", "Errores", "Coste real de IA", "Actividad reciente"]}
    />
  );
}
