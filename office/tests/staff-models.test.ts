// Modelos GLB del equipo: contenido seguro, licencia registrada y postura
// sentada correcta para cada estado real.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Box3, Quaternion, Vector3, type Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { describe, expect, it } from "vitest";
import { POSE_BONES, RIG_BONES, findPoseBones, pose, restOf } from "@/components/office/scene/staff-pose";
import { PILOT_AGENT_IDS } from "@/lib/agents/catalog";
import { AGENT_IDS } from "@/lib/agents/registry";
import { sceneLook, type Pose } from "@/lib/office/scene";
import { STAFF_MODELS } from "@/lib/office/staff-models";
import { LOD_PX, lodLevelFor } from "@/components/office/scene/staff-model";

const PUBLIC = join(__dirname, "..", "public");
const ALLOWED_EXT = new Set(["EXT_meshopt_compression", "KHR_mesh_quantization", "EXT_texture_webp"]);
/** Límite de peso por tipo: low-poly sin texturas o realista con texturas WebP de 1024 px. */
const MAX_KB = { quaternius: 500, makehuman: 2600 } as const;
const entries = Object.entries(STAFF_MODELS);
/** Cada archivo servido (LOD0 y, si los hay, LOD1 y LOD2) con la ficha de su personaje. */
const files = entries.flatMap(([id, m]) => [m.url, ...(m.lods ?? [])].map((url, lod) => [`${id} LOD${lod}`, { ...m, url }] as const));

function glbJson(buf: Buffer) {
  expect(buf.toString("ascii", 0, 4)).toBe("glTF");
  expect(buf.readUInt32LE(4)).toBe(2);
  const len = buf.readUInt32LE(12);
  expect(buf.toString("ascii", 16, 20)).toBe("JSON");
  return JSON.parse(buf.toString("utf8", 20, 20 + len));
}

/** En Node no se pueden decodificar imágenes: se quitan las texturas del GLB antes de cargarlo (la geometría y el esqueleto no cambian). */
function withoutTextures(buf: Buffer): Buffer {
  const len = buf.readUInt32LE(12);
  const json = JSON.parse(buf.toString("utf8", 20, 20 + len));
  delete json.images; delete json.textures; delete json.samplers;
  json.extensionsUsed = (json.extensionsUsed ?? []).filter((e: string) => e !== "EXT_texture_webp");
  json.extensionsRequired = (json.extensionsRequired ?? []).filter((e: string) => e !== "EXT_texture_webp");
  for (const m of json.materials ?? []) {
    if (m.pbrMetallicRoughness) { delete m.pbrMetallicRoughness.baseColorTexture; delete m.pbrMetallicRoughness.metallicRoughnessTexture; }
    delete m.normalTexture; delete m.occlusionTexture; delete m.emissiveTexture;
  }
  let text = JSON.stringify(json);
  while (text.length % 4) text += " ";
  const jsonChunk = Buffer.from(text, "utf8");
  const rest = buf.subarray(20 + len);
  const head = Buffer.alloc(20);
  head.write("glTF", 0, "ascii"); head.writeUInt32LE(2, 4); head.writeUInt32LE(20 + jsonChunk.length + rest.length, 8);
  head.writeUInt32LE(jsonChunk.length, 12); head.write("JSON", 16, "ascii");
  return Buffer.concat([head, jsonChunk, rest]);
}

async function load(raw: Buffer) {
  await MeshoptDecoder.ready;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const buf = withoutTextures(raw);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return new Promise<{ scene: Object3D }>((ok, ko) => loader.parse(ab, "", ok, ko));
}

describe("modelos GLB del equipo", () => {
  it("hay un modelo realista para cada agente del registro (y solo para ellos)", () => {
    expect(Object.keys(STAFF_MODELS).sort()).toEqual([...AGENT_IDS].sort());
    for (const m of Object.values(STAFF_MODELS)) expect(m.rig).toBe("makehuman");
  });

  it("tener modelo no activa a nadie: fuera del piloto, postura de inactivo y sin animación", () => {
    for (const id of AGENT_IDS) {
      const look = sceneLook(id, "working");
      if ((PILOT_AGENT_IDS as readonly string[]).includes(id)) expect(look.inactive).toBeFalsy();
      else {
        expect(look.inactive).toBe(true);
        expect(look.animated).toBe(false);
        expect(look.pose).toBe("off");
      }
    }
  });

  it.each(files)("%s: archivo local, sin recursos externos ni extensiones inesperadas", (_id, m) => {
    expect(m.url.startsWith("/models/")).toBe(true);
    const file = join(PUBLIC, m.url);
    expect(existsSync(file)).toBe(true);
    const buf = readFileSync(file);
    const rig = m.rig ?? "quaternius";
    expect(buf.length).toBeLessThan(MAX_KB[rig] * 1024);
    const json = glbJson(buf);
    for (const b of json.buffers ?? []) expect(b.uri).toBeUndefined();
    // Imágenes solo incrustadas en el propio GLB (nunca por URL) y en formatos de imagen web.
    for (const img of json.images ?? []) {
      expect(img.uri).toBeUndefined();
      expect(["image/webp", "image/png", "image/jpeg"]).toContain(img.mimeType);
    }
    for (const e of json.extensionsUsed ?? []) expect(ALLOWED_EXT.has(e)).toBe(true);
    if (rig === "makehuman") expect(json.skins ?? []).toHaveLength(1); // un solo esqueleto por personaje realista
    const joints = new Set((json.skins?.[0]?.joints ?? []).map((i: number) => String(json.nodes[i].name).replace(/\./g, "")));
    for (const b of POSE_BONES) expect(joints.has(RIG_BONES[rig][b])).toBe(true);
    if (rig === "quaternius") expect((json.animations ?? []).map((a: { name: string }) => a.name)).toContain("Idle_Neutral");
  });

  it.each(files)("%s: licencia y huella registradas en LICENCIAS.md", (_id, m) => {
    const lic = readFileSync(join(PUBLIC, "models/equipo/LICENCIAS.md"), "utf8");
    const name = m.url.split("/").pop()!;
    const sha = createHash("sha256").update(readFileSync(join(PUBLIC, m.url))).digest("hex");
    const row = lic.split("\n").find((l) => l.startsWith(`| ${name} `));
    expect(row).toBeDefined();
    expect(row).toContain("CC0 1.0");
    expect(row).toContain(sha);
  });

  const POSES: Pose[] = ["idle", "typing", "thinking", "reading", "waiting", "alert", "done", "off"];

  it.each(files)("%s: sentado y con las manos a la altura de la mesa en cada postura", async (_id, m) => {
    const { scene } = await load(readFileSync(join(PUBLIC, m.url)));
    const bones = findPoseBones(scene, m.rig ?? "quaternius", m.url);
    const rest = restOf(bones);
    const p = (o: Object3D) => o.getWorldPosition(new Vector3());
    const standing = new Box3().setFromObject(scene).getSize(new Vector3()).y;
    expect(standing).toBeGreaterThan(m.height * 0.9);
    let workingWristY = 0;
    for (const name of [...POSES.filter((x) => x !== "off"), "off" as const]) {
      const look = { ...sceneLook("alex", "available"), pose: name, inactive: name === "off" };
      pose(bones, rest, scene, look, 0, false);
      const hips = p(bones.Hips), knee = p(bones.LowerLegL), foot = p(bones.FootL), head = p(bones.Head);
      // Muslo horizontal hacia delante (+z), espinilla hacia el suelo.
      expect(Math.abs(knee.y - hips.y)).toBeLessThan(0.15);
      expect(knee.z - hips.z).toBeGreaterThan(0.25);
      expect(foot.y).toBeLessThan(knee.y - 0.3);
      expect(head.y).toBeGreaterThan(hips.y + 0.5);
      for (const w of [bones.WristL, bones.WristR]) {
        const q = w.getWorldQuaternion(new Quaternion());
        expect(Number.isFinite(q.x + q.y + q.z + q.w)).toBe(true);
      }
      const wristL = p(bones.WristL);
      if (name === "typing") workingWristY = wristL.y;
      if (name === "off") expect(wristL.y).toBeLessThan(workingWristY); // inactivo: manos bajadas, lejos del teclado
      else expect(wristL.z - hips.z).toBeGreaterThan(0.25); // manos hacia la mesa
    }
    // Las inclinaciones no se acumulan al repetir el mismo estado.
    const look = { ...sceneLook("alex", "available"), pose: "reading" as Pose };
    pose(bones, rest, scene, look, 0, false);
    const once = bones.Head.quaternion.clone();
    pose(bones, rest, scene, look, 0, false);
    expect(bones.Head.quaternion.angleTo(once)).toBeLessThan(1e-6);
  });

  it("los niveles de detalle tienen menos triángulos y pesan menos que el LOD0", () => {
    const tris = (url: string) => {
      const json = glbJson(readFileSync(join(PUBLIC, url)));
      return json.meshes.reduce((n: number, mesh: { primitives: { indices: number }[] }) => n + mesh.primitives.reduce((k, p) => k + json.accessors[p.indices].count / 3, 0), 0);
    };
    for (const [, m] of entries) {
      if (!m.lods) continue;
      const [t0, t1, t2] = [m.url, ...m.lods].map(tris);
      const [s0, s1, s2] = [m.url, ...m.lods].map((u) => readFileSync(join(PUBLIC, u)).length);
      expect(t1).toBeLessThan(t0 * 0.7);
      expect(t2).toBeLessThan(t1 * 0.5);
      expect(s1).toBeLessThan(s0);
      expect(s2).toBeLessThan(s1);
    }
  });

  it("cambio de nivel según el tamaño en pantalla, con histéresis y tope en móvil", () => {
    expect(lodLevelFor(400, 2, 3)).toBe(0);
    expect(lodLevelFor(120, 2, 3)).toBe(1);
    expect(lodLevelFor(30, 0, 3)).toBe(2);
    // Justo encima del umbral no sube si viene de un nivel más ligero (evita parpadeos)...
    expect(lodLevelFor(LOD_PX[0] * 1.05, 1, 3)).toBe(1);
    // ...y justo debajo no baja si ya estaba en el detallado.
    expect(lodLevelFor(LOD_PX[0] * 0.95, 0, 3)).toBe(0);
    // En móvil (nivel mínimo 1) nunca se usa el LOD0; un modelo con un solo archivo siempre usa el 0.
    expect(lodLevelFor(1000, 2, 3, 1)).toBe(1);
    expect(lodLevelFor(10, 0, 1)).toBe(0);
  });
});
