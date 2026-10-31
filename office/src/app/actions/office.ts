"use server";

import type { OfficeSnapshot } from "@/components/office/types";
import { requireViewer } from "@/lib/auth/session";
import { getOfficeSnapshot } from "@/lib/data/office";

/** Relectura de la oficina tras un aviso de Realtime o una reconexión. Solo lee. */
export async function refreshOffice(): Promise<OfficeSnapshot> {
  return getOfficeSnapshot(await requireViewer());
}
