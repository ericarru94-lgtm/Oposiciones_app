// Distribución de la oficina 3D: un puesto por agente, dentro de la planta y sin solaparse.
import { describe, expect, it } from "vitest";
import { AGENTS } from "@/lib/agents/registry";
import { MEETING, OFFICE_SIZE, STATIONS, stationOf } from "@/lib/office/layout";

describe("distribución de la oficina", () => {
  it("hay exactamente un puesto por cada uno de los nueve agentes", () => {
    expect(STATIONS).toHaveLength(9);
    expect(new Set(STATIONS.map((s) => s.agentId))).toEqual(new Set(AGENTS.map((a) => a.id)));
    for (const a of AGENTS) expect(stationOf(a.id), a.id).toBeDefined();
  });

  it("cada zona queda dentro de la planta y no se solapa con otras ni con la sala de reuniones", () => {
    const rect = (x: number, z: number, w: number, d: number) => ({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 });
    const zones = STATIONS.map((s) => ({ id: s.agentId, ...rect(s.x + (s.zone.dx ?? 0), s.z + (s.zone.dz ?? 0), s.zone.w, s.zone.d) }));
    const meeting = { id: "reuniones", ...rect(MEETING.x, MEETING.z, MEETING.w + 1, MEETING.d + 1) };
    for (const z of zones) {
      expect(z.x0 >= -OFFICE_SIZE.w / 2 && z.x1 <= OFFICE_SIZE.w / 2 && z.z0 >= -OFFICE_SIZE.d / 2 && z.z1 <= OFFICE_SIZE.d / 2, z.id).toBe(true);
    }
    const all = [...zones, meeting];
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j];
      const overlap = a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;
      expect(overlap, `${a.id} / ${b.id}`).toBe(false);
    }
  });

  it("cada puesto tiene una pantalla y mobiliario propios de su función", () => {
    expect(new Set(STATIONS.map((s) => s.screen)).size).toBe(9);
    expect(stationOf("alex")!.props).toContain("glassOffice");
    expect(stationOf("david")!.props).toContain("serverRack");
  });
});
