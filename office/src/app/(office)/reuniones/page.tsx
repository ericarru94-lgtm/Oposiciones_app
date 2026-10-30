import { Upcoming } from "@/components/upcoming";
import { requireViewer } from "@/lib/auth/session";

export default async function Page() {
  await requireViewer();
  return (
    <Upcoming
      href="/reuniones"
      points={["Elegir participantes", "Cada agente aporta su perspectiva", "Alex sintetiza las conclusiones", "Las conclusiones se guardan en la memoria"]}
    />
  );
}
