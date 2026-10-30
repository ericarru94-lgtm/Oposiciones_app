import { Upcoming } from "@/components/upcoming";
import { requireViewer } from "@/lib/auth/session";

export default async function Page() {
  await requireViewer();
  return (
    <Upcoming
      href="/crm"
      points={["Empresas, contactos y oportunidades", "Servicios contratados y seguimientos", "Ficha independiente por cliente", "Importar la hoja de prospección de los 30 centros"]}
    />
  );
}
