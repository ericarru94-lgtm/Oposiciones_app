import { Upcoming } from "@/components/upcoming";

export default function Page() {
  return (
    <Upcoming
      href="/reuniones"
      points={["Elegir participantes", "Cada agente aporta su perspectiva", "Alex sintetiza las conclusiones", "Las conclusiones se guardan en la memoria"]}
    />
  );
}
