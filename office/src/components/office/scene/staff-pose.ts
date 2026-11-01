// Postura de los trabajadores con modelo GLB, calculada sobre el esqueleto.
// Sin React: se usa en la escena y en las pruebas. Solo depende del estado real
// recibido en `look` (y del reloj, que solo avanza si ese estado está animado).

import { Quaternion, Vector3, type Object3D } from "three";
import type { SceneLook } from "@/lib/office/scene";

/** Huesos que mueve la postura (Three quita los puntos: «UpperLeg.L» → «UpperLegL»). */
export const POSE_BONES = ["Hips", "Chest", "Neck", "Head", "UpperArmL", "LowerArmL", "WristL", "UpperArmR", "LowerArmR", "WristR", "UpperLegL", "LowerLegL", "FootL", "UpperLegR", "LowerLegR", "FootR"] as const;
export type BoneName = (typeof POSE_BONES)[number];

/** De la animación «Idle_Neutral» solo se conserva la respiración del tronco y la cabeza. */
export const BREATH_TRACKS = /^(Abdomen|Torso|Chest|Neck|Head)\.(quaternion)$/;

const v1 = new Vector3(), v2 = new Vector3(), want = new Vector3();
const q1 = new Quaternion(), q2 = new Quaternion(), q3 = new Quaternion(), rootQ = new Quaternion();

/** Gira `bone` para que su hijo quede en la dirección `dir` (ejes del modelo: +z delante, +y arriba, +x su izquierda). */
function aim(bone: Object3D, child: Object3D, dir: Vector3) {
  bone.getWorldPosition(v1);
  child.getWorldPosition(v2);
  const cur = v2.sub(v1).normalize();
  want.copy(dir).normalize().applyQuaternion(rootQ);
  q1.setFromUnitVectors(cur, want);
  bone.getWorldQuaternion(q2);
  bone.parent!.getWorldQuaternion(q3);
  bone.quaternion.copy(q3.invert().multiply(q1.multiply(q2)));
  bone.updateMatrixWorld(true);
}

/** Inclina un hueso alrededor de un eje del modelo. */
function tilt(bone: Object3D, axis: Vector3, angle: number) {
  if (!angle) return;
  bone.rotateOnWorldAxis(v1.copy(axis).applyQuaternion(rootQ), angle);
  bone.updateMatrixWorld(true);
}

const X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0), Z = new Vector3(0, 0, 1);
const d = (x: number, y: number, z: number) => new Vector3(x, y, z);

/** Postura según el estado real. `t` solo avanza cuando el estado está animado. */
export function pose(b: Record<BoneName, Object3D>, rest: Map<Object3D, Quaternion>, root: Object3D, look: SceneLook, t: number, moving: boolean) {
  // Sin animación, las inclinaciones parten siempre de la postura de reposo (no se acumulan).
  if (!moving) rest.forEach((q, bone) => bone.quaternion.copy(q));
  root.updateMatrixWorld(true);
  root.getWorldQuaternion(rootQ);
  // Sentado: muslos hacia delante y espinillas hacia el suelo.
  aim(b.UpperLegL, b.LowerLegL, d(0.1, -0.08, 1));
  aim(b.UpperLegR, b.LowerLegR, d(-0.1, -0.08, 1));
  aim(b.LowerLegL, b.FootL, d(0.02, -1, 0.18));
  aim(b.LowerLegR, b.FootR, d(-0.02, -1, 0.18));

  const p = look.pose;
  const wave = moving ? Math.sin(t * 11) : 0;
  // Tronco: algo inclinado hacia la mesa al trabajar; recostado y cabizbajo si está inactivo.
  tilt(b.Chest, X, p === "off" ? -0.05 : p === "typing" || p === "reading" ? 0.12 : 0.04);

  if (p === "off") {
    // Inactivo: manos en el regazo.
    aim(b.UpperArmL, b.LowerArmL, d(0.12, -1, 0.15));
    aim(b.UpperArmR, b.LowerArmR, d(-0.12, -1, 0.15));
    aim(b.LowerArmL, b.WristL, d(-0.35, -0.35, 1));
    aim(b.LowerArmR, b.WristR, d(0.35, -0.35, 1));
    tilt(b.Head, X, 0.32);
    return;
  }
  // Codos junto al cuerpo y antebrazos hacia el teclado.
  aim(b.UpperArmL, b.LowerArmL, d(0.08, -1, 0.35));
  aim(b.UpperArmR, b.LowerArmR, d(-0.08, -1, 0.35));
  aim(b.LowerArmL, b.WristL, d(-0.22, -0.3 + (p === "typing" ? wave * 0.06 : 0), 1));
  if (p === "thinking") {
    // Mano derecha a la barbilla.
    aim(b.UpperArmR, b.LowerArmR, d(-0.2, -0.55, 0.8));
    aim(b.LowerArmR, b.WristR, d(0.3, 1, 0.15));
    tilt(b.Head, Z, moving ? Math.sin(t * 1.4) * 0.08 : 0.06);
    tilt(b.Head, X, -0.06);
  } else {
    aim(b.LowerArmR, b.WristR, d(0.22, -0.3 - (p === "typing" ? wave * 0.06 : 0), 1));
    tilt(b.Head, X, p === "reading" ? 0.22 : p === "alert" ? 0.12 : p === "done" ? -0.12 : -0.04);
    if (p === "reading" && moving) tilt(b.Head, Y, Math.sin(t * 0.9) * 0.14);
  }
}


/** Postura de reposo de los huesos que solo se inclinan (para no acumular giros). */
export function restOf(b: Record<BoneName, Object3D>): Map<Object3D, Quaternion> {
  return new Map([b.Chest, b.Head].map((o) => [o, o.quaternion.clone()]));
}
