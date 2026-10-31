import { OfficeView } from "@/components/office/office-view";
import { requireViewer } from "@/lib/auth/session";
import { getOfficeSnapshot } from "@/lib/data/office";
import { readEnv } from "@/lib/env";

export default async function OfficePage() {
  const viewer = await requireViewer();
  const snapshot = await getOfficeSnapshot(viewer);
  const env = readEnv();
  // Solo la URL y la clave publicable (pública por diseño); nunca la secreta.
  const realtime =
    viewer.mode === "admin" && env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
      ? { url: env.NEXT_PUBLIC_SUPABASE_URL, publishableKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY }
      : null;
  return <OfficeView initial={snapshot} realtime={realtime} />;
}
