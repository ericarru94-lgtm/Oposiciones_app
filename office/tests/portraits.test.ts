// Retratos de los trabajadores: una sola fuente de verdad, coherente con los
// modelos 3D aprobados, imágenes ligeras y sin metadatos, y avatar dibujado
// para quien todavía no tiene modelo.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentAvatar } from "@/components/agent-avatar";
import { PORTRAIT_STATUS, portraitOf } from "@/lib/agents/portraits";
import { AGENTS, AGENT_IDS } from "@/lib/agents/registry";
import { STAFF_MODELS } from "@/lib/office/staff-models";

const PUBLIC = join(__dirname, "..", "public");

/** Bloques RIFF de un WebP (VP8/VP8L/VP8X/ALPH/EXIF/XMP /ICCP…) y tamaño del lienzo. */
function webpInfo(buf: Buffer) {
  expect(buf.toString("ascii", 0, 4)).toBe("RIFF");
  expect(buf.toString("ascii", 8, 12)).toBe("WEBP");
  const chunks: string[] = [];
  let width = 0, height = 0;
  for (let o = 12; o + 8 <= buf.length; ) {
    const id = buf.toString("ascii", o, o + 4), size = buf.readUInt32LE(o + 4);
    chunks.push(id);
    if (id === "VP8X") { width = 1 + buf.readUIntLE(o + 12, 3); height = 1 + buf.readUIntLE(o + 15, 3); }
    o += 8 + size + (size % 2);
  }
  return { chunks, width, height };
}

describe("retratos de los trabajadores", () => {
  it("hay un estado de retrato para cada agente del registro, y solo para ellos", () => {
    expect(Object.keys(PORTRAIT_STATUS).sort()).toEqual([...AGENT_IDS].sort());
  });

  it("los retratos realistas son exactamente los agentes con modelo 3D aprobado", () => {
    const realistic = Object.keys(PORTRAIT_STATUS).filter((id) => PORTRAIT_STATUS[id] === "realista").sort();
    expect(realistic).toEqual(Object.keys(STAFF_MODELS).sort());
  });

  it.each(Object.keys(STAFF_MODELS))("%s: el retrato sale de su propio modelo y es una imagen ligera sin metadatos", (id) => {
    const p = portraitOf(id)!;
    expect(p).not.toBeNull();
    expect(p.model).toBe(STAFF_MODELS[id].url); // misma cara que en la oficina 3D
    expect(p.src).toBe(`/avatars/equipo/${id}.webp`);
    const file = join(PUBLIC, p.src);
    expect(existsSync(file)).toBe(true);
    const buf = readFileSync(file);
    expect(buf.length).toBeLessThan(20 * 1024);
    const info = webpInfo(buf);
    expect([info.width, info.height]).toEqual([p.width, p.height]);
    for (const meta of ["EXIF", "XMP ", "ICCP"]) expect(info.chunks).not.toContain(meta);
  });

  it("todos los agentes tienen retrato realista; un identificador desconocido no tiene", () => {
    for (const id of AGENT_IDS) expect(portraitOf(id)).not.toBeNull();
    expect(portraitOf("no-existe")).toBeNull();
  });

  it("el avatar usa el retrato por identificador estable, no por nombre", () => {
    for (const a of AGENTS) {
      const html = renderToStaticMarkup(createElement(AgentAvatar, { agentId: a.id, avatar: a.avatar, label: `Avatar de ${a.name}` }));
      if (PORTRAIT_STATUS[a.id] === "realista") {
        expect(html).toContain(`src="/avatars/equipo/${a.id}.webp"`);
        expect(html).toContain(`alt="Avatar de ${a.name}"`);
        expect(html).not.toContain("<svg");
      } else {
        expect(html).toContain("<svg");
        expect(html).not.toContain("/avatars/");
      }
    }
    // Mismo nombre visible pero otro identificador: no hereda el retrato.
    const alex = AGENTS.find((a) => a.id === "alex")!;
    const html = renderToStaticMarkup(createElement(AgentAvatar, { agentId: "alex-copia", avatar: alex.avatar, label: "Avatar de Alex" }));
    expect(html).not.toContain("/avatars/");
  });
});
