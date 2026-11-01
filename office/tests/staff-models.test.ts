// Modelos GLB del equipo: contenido seguro, licencia registrada y postura
// sentada correcta para cada estado real.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Box3, Quaternion, Vector3, type Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { describe, expect, it } from "vitest";
import { POSE_BONES, pose, restOf, type BoneName } from "@/components/office/scene/staff-pose";
import { PILOT_AGENT_IDS } from "@/lib/agents/catalog";
import { sceneLook, type Pose } from "@/lib/office/scene";
import { STAFF_MODELS } from "@/lib/office/staff-models";

const PUBLIC = join(__dirname, "..", "public");
const ALLOWED_EXT = new Set(["EXT_meshopt_compression", "KHR_mesh_quantization"]);
const entries = Object.entries(STAFF_MODELS);

function glbJson(buf: Buffer) {
  expect(buf.toString("ascii", 0, 4)).toBe("glTF");
  expect(buf.readUInt32LE(4)).toBe(2);
  const len = buf.readUInt32LE(12);
  expect(buf.toString("ascii", 16, 20)).toBe("JSON");
  return JSON.parse(buf.toString("utf8", 20, 20 + len));
}

async function load(buf: Buffer) {
  await MeshoptDecoder.ready;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return new Promise<{ scene: Object3D }>((ok, ko) => loader.parse(ab, "", ok, ko));
}

describe("modelos GLB del equipo", () => {
  it("solo hay modelos para los agentes del piloto en esta prueba", () => {
    for (const id of Object.keys(STAFF_MODELS)) expect(PILOT_AGENT_IDS).toContain(id);
  });

  it.each(entries)("%s: archivo local, sin recursos externos ni extensiones inesperadas", (_id, m) => {
    expect(m.url.startsWith("/models/")).toBe(true);
    const file = join(PUBLIC, m.url);
    expect(existsSync(file)).toBe(true);
    const buf = readFileSync(file);
    expect(buf.length).toBeLessThan(500 * 1024);
    const json = glbJson(buf);
    for (const b of json.buffers ?? []) expect(b.uri).toBeUndefined();
    expect(json.images ?? []).toHaveLength(0);
    for (const e of json.extensionsUsed ?? []) expect(ALLOWED_EXT.has(e)).toBe(true);
    const joints = new Set((json.skins?.[0]?.joints ?? []).map((i: number) => String(json.nodes[i].name).replace(/\./g, "")));
    for (const b of POSE_BONES) expect(joints.has(b)).toBe(true);
    expect((json.animations ?? []).map((a: { name: string }) => a.name)).toContain("Idle_Neutral");
  });

  it.each(entries)("%s: licencia y huella registradas en LICENCIAS.md", (_id, m) => {
    const lic = readFileSync(join(PUBLIC, "models/equipo/LICENCIAS.md"), "utf8");
    const name = m.url.split("/").pop()!;
    const sha = createHash("sha256").update(readFileSync(join(PUBLIC, m.url))).digest("hex");
    const row = lic.split("\n").find((l) => l.startsWith(`| ${name} `));
    expect(row).toBeDefined();
    expect(row).toContain("CC0 1.0");
    expect(row).toContain(sha);
  });

  const POSES: Pose[] = ["idle", "typing", "thinking", "reading", "waiting", "alert", "done", "off"];

  it.each(entries)("%s: sentado y con las manos a la altura de la mesa en cada postura", async (_id, m) => {
    const { scene } = await load(readFileSync(join(PUBLIC, m.url)));
    const bones = {} as Record<BoneName, Object3D>;
    for (const n of POSE_BONES) bones[n] = scene.getObjectByName(n)!;
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
});
