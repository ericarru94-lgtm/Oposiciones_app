"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

// Mientras la misión tenga trabajo y esta página esté abierta, pide pasadas
// del motor al servidor y refresca los datos. No guarda nada: todo el estado
// está en la base de datos, así que cerrar la página solo pausa el trabajo.
export function EngineRunner({ active }: { active: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "running" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const wake = useRef<() => void>(() => {});

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const id = setTimeout(resolve, ms);
      wake.current = () => {
        clearTimeout(id);
        resolve();
      };
    });

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const refresh = setInterval(() => router.refresh(), 8_000);
    (async () => {
      while (!stopped) {
        if (document.visibilityState !== "visible") {
          setState("idle");
          await sleep(3_000);
          continue;
        }
        setState("running");
        try {
          const res = await fetch("/api/engine/tick", { method: "POST" });
          const body = (await res.json().catch(() => ({}))) as { error?: string; runs?: unknown[] };
          if (!res.ok) {
            setState("error");
            setMessage(body.error ?? `Error ${res.status}`);
            await sleep(30_000);
          } else {
            setMessage(null);
            router.refresh();
            // Sin trabajo disponible ahora (esperando o reintento programado): espera más.
            await sleep(body.runs?.length ? 2_000 : 15_000);
          }
        } catch {
          setState("error");
          setMessage("Sin conexión con el servidor.");
          await sleep(30_000);
        }
      }
    })();
    return () => {
      stopped = true;
      clearInterval(refresh);
      wake.current();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, router]);

  const resumeNow = useCallback(() => wake.current(), []);

  if (!active) return null;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p role="status" className={`text-xs ${state === "error" ? "text-signal" : "text-muted"}`}>
        {state === "error"
          ? `No se ha podido contactar con el motor: ${message}. Se reintentará en 30 s.`
          : state === "idle"
            ? "Página en segundo plano: el trabajo está en pausa."
            : "Conectado al motor. Mantén esta página abierta mientras trabajan."}
      </p>
      <button type="button" onClick={resumeNow} className="rounded-lg border border-line px-3 py-1.5 text-xs hover:border-cobalt">
        Reanudar ahora
      </button>
    </div>
  );
}
