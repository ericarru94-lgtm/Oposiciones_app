// Oficina: mapeo estado real → escena, elección de vista y sincronización
// Realtime (avisos, reconexión, respuestas fuera de orden y limpieza).
import { describe, expect, it, vi } from "vitest";
import { AGENTS } from "@/lib/agents/registry";
import { AGENT_STATUSES } from "@/lib/domain/status";
import { chooseView, needsAnimation, sceneLook } from "@/lib/office/scene";
import { OfficeSync, type ChannelStatus } from "@/lib/office/sync";

describe("escena", () => {
  it("los seis agentes fuera del piloto aparecen inactivos sea cual sea su estado guardado", () => {
    const off = AGENTS.filter((a) => !["alex", "marcus", "sofia"].includes(a.id));
    expect(off).toHaveLength(6);
    for (const a of off) for (const s of AGENT_STATUSES) {
      expect(sceneLook(a.id, s)).toMatchObject({ inactive: true, animated: false, pose: "off", screen: "off" });
    }
  });

  it("solo se anima lo que está en curso; disponible, esperando, completado y error son imágenes fijas", () => {
    const animated = AGENT_STATUSES.filter((s) => sceneLook("marcus", s).animated);
    expect(animated.sort()).toEqual(["executing_tool", "receiving", "researching", "reviewing", "thinking", "waiting_approval", "working"].sort());
    expect(sceneLook("marcus", "error")).toMatchObject({ screen: "error", animated: false });
    expect(needsAnimation([{ id: "alex", status: "available" }, { id: "daniel", status: "working" }], false)).toBe(false);
    expect(needsAnimation([{ id: "alex", status: "working" }], false)).toBe(true);
    expect(needsAnimation([{ id: "alex", status: "working" }], true)).toBe(false);
  });

  it("sin WebGL siempre lista; móvil y «reducir movimiento» empiezan en lista; la preferencia guardada manda", () => {
    expect(chooseView({ webgl: false, width: 1440, reducedMotion: false, saved: "3d" })).toBe("list");
    expect(chooseView({ webgl: true, width: 390, reducedMotion: false, saved: null })).toBe("list");
    expect(chooseView({ webgl: true, width: 1440, reducedMotion: true, saved: null })).toBe("list");
    expect(chooseView({ webgl: true, width: 1440, reducedMotion: false, saved: null })).toBe("3d");
    expect(chooseView({ webgl: true, width: 390, reducedMotion: false, saved: "3d" })).toBe("3d");
  });
});

function harness() {
  let onChange = () => {};
  let onStatus: (s: ChannelStatus) => void = () => {};
  const closed = vi.fn();
  const states: string[] = [];
  const data: number[] = [];
  let n = 0;
  const pending: ((v: number) => void)[] = [];
  const refresh = vi.fn(() => new Promise<number>((r) => pending.push(r)));
  const sync = new OfficeSync<number>({
    transport: { subscribe: (c, s) => { onChange = c; onStatus = s; return closed; } },
    refresh,
    onData: (d) => data.push(d),
    onState: (s) => states.push(s),
    debounceMs: 300,
  });
  return { sync, states, data, refresh, closed, pending, change: () => onChange(), status: (s: ChannelStatus) => onStatus(s), next: () => ++n };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("sincronización Realtime", () => {
  it("al conectar relee de Supabase; los avisos se agrupan; al reconectar vuelve a leer todo", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.sync.start();
    expect(h.states).toEqual(["connecting"]);
    h.status("SUBSCRIBED");
    expect(h.states.at(-1)).toBe("live");
    expect(h.refresh).toHaveBeenCalledTimes(1);
    h.pending.shift()!(1);
    // Ráfaga de 5 avisos → una sola relectura.
    for (let i = 0; i < 5; i++) h.change();
    vi.advanceTimersByTime(299);
    expect(h.refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(h.refresh).toHaveBeenCalledTimes(2);
    h.pending.shift()!(2);
    // Corte y reconexión: estado visible y relectura completa.
    h.status("CHANNEL_ERROR");
    expect(h.states.at(-1)).toBe("reconnecting");
    h.status("SUBSCRIBED");
    expect(h.states.at(-1)).toBe("live");
    expect(h.refresh).toHaveBeenCalledTimes(3);
    h.pending.shift()!(3);
    vi.useRealTimers();
    await flush();
    expect(h.data).toEqual([1, 2, 3]);
  });

  it("una respuesta lenta no pisa una más reciente", async () => {
    const h = harness();
    h.sync.start();
    h.status("SUBSCRIBED"); // lectura 1 (lenta)
    h.sync.resync(); // lectura 2
    h.pending[1](20);
    await flush();
    h.pending[0](10);
    await flush();
    expect(h.data).toEqual([20]);
  });

  it("al desmontar cierra la suscripción y no aplica nada más", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.sync.start();
    h.status("SUBSCRIBED");
    h.change();
    h.sync.stop();
    expect(h.closed).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(h.refresh).toHaveBeenCalledTimes(1); // el aviso pendiente se descartó
    h.pending[0](1);
    vi.useRealTimers();
    await flush();
    expect(h.data).toEqual([]);
  });

  it("sin Realtime (vista previa local) queda «disabled» y no abre nada", () => {
    const states: string[] = [];
    new OfficeSync({ transport: null, refresh: async () => 1, onData: () => {}, onState: (s) => states.push(s) }).start();
    expect(states).toEqual(["disabled"]);
  });

  it("un fallo al releer mientras estaba en directo se muestra como reconectando", async () => {
    const states: string[] = [];
    let status: (s: ChannelStatus) => void = () => {};
    const s = new OfficeSync({
      transport: { subscribe: (_c, st) => { status = st; return () => {}; } },
      refresh: async () => { throw new Error("red"); },
      onData: () => {},
      onState: (x) => states.push(x),
    });
    s.start();
    status("SUBSCRIBED");
    await flush();
    expect(states).toEqual(["connecting", "live", "reconnecting"]);
  });
});
