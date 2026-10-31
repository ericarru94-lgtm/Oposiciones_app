"use client";

import { createBrowserClient } from "@supabase/ssr";
import { useEffect, useRef, useState } from "react";
import { refreshOffice } from "@/app/actions/office";
import { OFFICE_TABLES, OfficeSync, type ChannelStatus, type ConnectionState, type Transport } from "@/lib/office/sync";
import type { OfficeSnapshot } from "./types";

export interface RealtimeConfig {
  url: string;
  /** Clave publicable (pública por diseño). La secreta nunca llega al navegador. */
  publishableKey: string;
}

function supabaseTransport(cfg: RealtimeConfig): Transport {
  return {
    subscribe(onChange, onStatus) {
      // Usa la sesión de las cookies: Realtime aplica RLS (solo el administrador recibe cambios).
      const supabase = createBrowserClient(cfg.url, cfg.publishableKey);
      let channel = supabase.channel("office");
      for (const table of OFFICE_TABLES) {
        channel = channel.on("postgres_changes", { event: "*", schema: "public", table }, onChange);
      }
      channel.subscribe((s) => onStatus(s as ChannelStatus));
      return () => {
        void supabase.removeChannel(channel);
      };
    },
  };
}

export function useOfficeSync(initial: OfficeSnapshot, realtime: RealtimeConfig | null) {
  const [snapshot, setSnapshot] = useState(initial);
  const [connection, setConnection] = useState<ConnectionState>(realtime ? "connecting" : "disabled");
  const sync = useRef<OfficeSync<OfficeSnapshot> | null>(null);

  useEffect(() => {
    const s = new OfficeSync<OfficeSnapshot>({
      transport: realtime ? supabaseTransport(realtime) : null,
      refresh: () => refreshOffice(),
      onData: setSnapshot,
      onState: setConnection,
    });
    sync.current = s;
    s.start();
    const again = () => document.visibilityState === "visible" && s.resync();
    const offline = () => setConnection("offline");
    window.addEventListener("online", again);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", again);
    return () => {
      window.removeEventListener("online", again);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", again);
      s.stop();
      sync.current = null;
    };
  }, [realtime?.url, realtime?.publishableKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return { snapshot, connection, resync: () => sync.current?.resync() };
}
