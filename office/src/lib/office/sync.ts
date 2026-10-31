// Sincronización de la oficina. Realtime solo avisa de que algo cambió; el
// estado se vuelve a leer siempre de Supabase con la sesión del usuario (RLS),
// que es la fuente de verdad. Así un aviso perdido durante una desconexión no
// deja la oficina desfasada: al reconectar se relee todo.

export type ConnectionState = "connecting" | "live" | "reconnecting" | "offline" | "disabled";

export type ChannelStatus = "SUBSCRIBED" | "TIMED_OUT" | "CLOSED" | "CHANNEL_ERROR";

export interface Transport {
  /** Abre la suscripción; devuelve la función que la cierra. */
  subscribe(onChange: () => void, onStatus: (s: ChannelStatus) => void): () => void;
}

export interface SyncOptions<T> {
  transport: Transport | null;
  refresh: () => Promise<T>;
  onData: (data: T) => void;
  onState: (s: ConnectionState) => void;
  debounceMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

export class OfficeSync<T> {
  private state: ConnectionState = "connecting";
  private timer: unknown = null;
  private seq = 0;
  private applied = 0;
  private close: (() => void) | null = null;
  private stopped = false;
  private wasLive = false;

  constructor(private o: SyncOptions<T>) {}

  start() {
    if (!this.o.transport) {
      this.set("disabled");
      return;
    }
    this.set("connecting");
    this.close = this.o.transport.subscribe(
      () => this.schedule(),
      (s) => this.status(s),
    );
  }

  stop() {
    this.stopped = true;
    if (this.timer !== null) (this.o.clearTimer ?? clearTimeout)(this.timer as never);
    this.timer = null;
    this.close?.();
    this.close = null;
  }

  /** Vuelta a la pestaña o a la red: relee aunque Realtime no haya avisado. */
  resync() {
    if (!this.stopped) void this.load();
  }

  private status(s: ChannelStatus) {
    if (this.stopped) return;
    if (s === "SUBSCRIBED") {
      this.set("live");
      // Primera conexión o reconexión: relee para cubrir lo que se perdió.
      void this.load();
      this.wasLive = true;
    } else if (s === "CLOSED") {
      this.set("offline");
    } else {
      this.set(this.wasLive ? "reconnecting" : "connecting");
    }
  }

  private schedule() {
    if (this.stopped) return;
    if (this.timer !== null) (this.o.clearTimer ?? clearTimeout)(this.timer as never);
    this.timer = (this.o.setTimer ?? setTimeout)(() => {
      this.timer = null;
      void this.load();
    }, this.o.debounceMs ?? 300);
  }

  private async load() {
    const n = ++this.seq;
    try {
      const data = await this.o.refresh();
      // Una respuesta lenta nunca pisa una más reciente.
      if (this.stopped || n < this.applied) return;
      this.applied = n;
      this.o.onData(data);
    } catch {
      if (!this.stopped && this.state === "live") this.set("reconnecting");
    }
  }

  private set(s: ConnectionState) {
    if (this.state === s && s !== "connecting") return;
    this.state = s;
    this.o.onState(s);
  }
}

/** Tablas que mueven la oficina (deben estar en la publicación supabase_realtime). */
export const OFFICE_TABLES = ["agents", "tasks", "approvals", "agent_runs"] as const;
