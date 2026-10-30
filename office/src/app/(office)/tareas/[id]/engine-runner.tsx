"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

// Mientras el encargo tiene trabajo pendiente y esta página está abierta,
// pide pasadas del motor al servidor (una cada vez) y refresca los datos.
// El servidor decide todo; aquí solo se muestra lo que hay en la base de datos.
export function EngineRunner({ active }: { active: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "running" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const refresh = setInterval(() => router.refresh(), 8_000);
    (async () => {
      while (!stopped) {
        if (document.visibilityState !== "visible") {
          await new Promise((r) => setTimeout(r, 3_000));
          continue;
        }
        setState("running");
        try {
          const res = await fetch("/api/engine/tick", { method: "POST" });
          const body = (await res.json().catch(() => ({}))) as { error?: string; runs?: unknown[] };
          if (!res.ok) {
            setState("error");
            setMessage(body.error ?? `Error ${res.status}`);
            await new Promise((r) => setTimeout(r, 30_000));
          } else {
            setMessage(null);
            router.refresh();
            // Sin trabajo disponible (esperando dependencias o reintento): espera un poco más.
            await new Promise((r) => setTimeout(r, body.runs?.length ? 2_000 : 15_000));
          }
        } catch {
          setState("error");
          setMessage("Sin conexión con el servidor.");
          await new Promise((r) => setTimeout(r, 30_000));
        }
      }
    })();
    return () => {
      stopped = true;
      clearInterval(refresh);
    };
  }, [active, router]);

  if (!active) return null;
  return (
    <p role="status" className={`text-xs ${state === "error" ? "text-signal" : "text-muted"}`}>
      {state === "error" ? `Motor detenido: ${message}. Se reintentará en 30 s.` : "El equipo está trabajando. Mantén esta página abierta; los datos se actualizan solos."}
    </p>
  );
}
