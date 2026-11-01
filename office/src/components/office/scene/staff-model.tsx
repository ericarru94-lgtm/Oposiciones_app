"use client";

// Trabajador con modelo 3D profesional (GLB con esqueleto). La postura sentada
// y los gestos se calculan apuntando huesos en el espacio del propio modelo,
// así que funciona con cualquier esqueleto humanoide que tenga estos huesos.
//
// Igual que la figura generada por código, solo dibuja el estado real que
// recibe en `look`: sin estado activo no hay animación de trabajo.

import { useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { AnimationMixer, Color, type AnimationClip, type Group, type Material, type Mesh, type MeshStandardMaterial, type Object3D } from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { AvatarSpec } from "@/lib/agents/catalog";
import type { SceneLook } from "@/lib/office/scene";
import type { StaffModel as StaffModelSpec } from "@/lib/office/staff-models";
import { BREATH_TRACKS, POSE_BONES, pose, restOf, type BoneName } from "./staff-pose";

const OFF_SKIN = new Color("#6b7385");
const OFF_CLOTH = new Color("#3a4152");

/** Piel y pelo del avatar del agente (los mismos de su ficha), aplicados a los materiales del modelo. */
function identityColor(name: string, avatar: AvatarSpec): Color | null {
  if (name === "Skin") return new Color(avatar.skin);
  if (name.startsWith("Skin_")) return new Color(avatar.skin).multiplyScalar(0.82);
  if (name.startsWith("Hair")) return new Color(avatar.hair);
  if (name === "Eyebrows") return new Color(avatar.hair).multiplyScalar(0.7);
  return null;
}

export function StaffModel({ model, avatar, look, reducedMotion }: { model: StaffModelSpec; avatar: AvatarSpec; look: SceneLook; reducedMotion: boolean }) {
  const gltf = useGLTF(model.url);
  const invalidate = useThree((s) => s.invalidate);
  // Cada puesto tiene su copia del esqueleto; la geometría se comparte desde la caché.
  const root = useMemo(() => cloneSkinned(gltf.scene) as Group, [gltf.scene]);
  const bones = useMemo(() => {
    const b = {} as Record<BoneName, Object3D>;
    for (const n of POSE_BONES) {
      const o = root.getObjectByName(n);
      if (!o) throw new Error(`Modelo sin el hueso ${n}: ${model.url}`);
      b[n] = o;
    }
    return b;
  }, [root, model.url]);
  const rest = useMemo(() => restOf(bones), [bones]);

  // Materiales propios del puesto (colores de identidad o gris si está inactivo).
  useEffect(() => {
    const owned: Material[] = [];
    root.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      const src = mesh.material as MeshStandardMaterial;
      const m = src.clone();
      const hex = model.tint?.[src.name];
      const id = identityColor(src.name, avatar);
      if (hex) m.color.set(hex);
      else if (id) m.color.copy(id);
      m.roughness = /Eye/.test(src.name) ? 0.25 : 0.7;
      m.metalness = 0;
      if (look.inactive) m.color.copy(/Skin/.test(src.name) ? OFF_SKIN : OFF_CLOTH).multiplyScalar(0.6 + m.color.getHSL({ h: 0, s: 0, l: 0 }).l * 0.6);
      mesh.material = m;
      owned.push(m);
    });
    invalidate();
    return () => owned.forEach((m) => m.dispose());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo importan piel y pelo, no la identidad del objeto
  }, [root, model.tint, avatar.skin, avatar.hair, look.inactive, invalidate]);

  // Respiración del tronco: solo la pista del torso y la cabeza de «Idle_Neutral».
  const mixer = useMemo(() => {
    const clip = gltf.animations.find((a) => a.name === "Idle_Neutral");
    if (!clip) return null;
    const breath = clip.clone() as AnimationClip;
    breath.tracks = breath.tracks.filter((tr) => BREATH_TRACKS.test(tr.name));
    const mx = new AnimationMixer(root);
    mx.clipAction(breath).play();
    return mx;
  }, [gltf.animations, root]);
  useEffect(() => () => {
    mixer?.stopAllAction();
  }, [mixer]);

  const moving = look.animated && !reducedMotion && !look.inactive;
  const clock = useRef(0);
  const dots = useRef<Group>(null);

  // Postura estática al montar o al cambiar de estado (un solo dibujo).
  useEffect(() => {
    pose(bones, rest, root, look, 0, false);
    if (dots.current) dots.current.visible = look.pose === "thinking" && !look.inactive;
    invalidate();
  }, [bones, rest, root, look, invalidate]);

  useFrame((_, dt) => {
    if (!moving) return;
    clock.current += dt;
    mixer?.update(dt);
    pose(bones, rest, root, look, clock.current, true);
    if (dots.current) dots.current.children.forEach((c, i) => (c.position.y = 0.05 + Math.max(0, Math.sin(clock.current * 3 - i * 0.7)) * 0.06));
  });

  // El origen del modelo está en los pies (de pie): se baja para que la cadera quede sobre el asiento.
  const hipsY = 0.858 * (model.height / 1.86);
  return (
    <group scale={model.scale} userData={{ dynamic: true }}>
      <group rotation-y={Math.PI} position={[0, 0.555 - hipsY, 0.05]}>
        <primitive object={root} />
      </group>
      <group ref={dots} position={[0.32, 1.62, 0]} visible={false} userData={{ dynamic: true }}>
        {[0, 1, 2].map((i) => (
          <mesh key={i} position={[i * 0.11, 0.05, 0]}>
            <sphereGeometry args={[0.035, 10, 8]} />
            <meshStandardMaterial color="#ffffff" emissive="#9fb1ff" emissiveIntensity={0.6} />
          </mesh>
        ))}
      </group>
    </group>
  );
}
