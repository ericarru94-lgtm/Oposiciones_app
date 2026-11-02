"use client";

// Trabajador con modelo 3D profesional (GLB con esqueleto). La postura sentada
// y los gestos se calculan apuntando huesos en el espacio del propio modelo,
// así que funciona con cualquier esqueleto humanoide que tenga estos huesos.
//
// Igual que la figura generada por código, solo dibuja el estado real que
// recibe en `look`: sin estado activo no hay animación de trabajo.

import { useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { AnimationMixer, Color, Frustum, Matrix4, Sphere, Vector3, type AnimationClip, type Group, type Material, type Mesh, type MeshStandardMaterial, type Object3D, type OrthographicCamera, type Texture } from "three";
import type { GLTF } from "three-stdlib";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { AvatarSpec } from "@/lib/agents/catalog";
import type { SceneLook } from "@/lib/office/scene";
import type { StaffModel as StaffModelSpec } from "@/lib/office/staff-models";
import { BREATH_TRACKS, findPoseBones, pose, restOf } from "./staff-pose";

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

// ---------------------------------------------------------------------------
// Caché de modelos cargados: permite liberar geometría y texturas de verdad
// (GPU incluida) al salir de la vista 3D.
const loaded = new Map<string, GLTF>();

/** Libera todos los modelos del equipo: geometrías, materiales y texturas, y los quita de la caché. */
export function releaseStaffModels() {
  for (const [url, gltf] of loaded) {
    gltf.scene.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      for (const m of ([] as Material[]).concat(mesh.material)) {
        for (const v of Object.values(m)) if ((v as Texture | null)?.isTexture) (v as Texture).dispose();
        m.dispose();
      }
    });
    useGLTF.clear(url);
  }
  loaded.clear();
}

// ---------------------------------------------------------------------------
// Niveles de detalle (LOD) según la altura del trabajador en pantalla.

/** Altura en píxeles a partir de la cual se usa cada nivel: ≥ LOD_PX[0] → LOD0; ≥ LOD_PX[1] → LOD1; si no, LOD2. */
export const LOD_PX = [180, 70] as const;
/** Margen para no oscilar entre dos niveles cerca del umbral. */
const LOD_HYSTERESIS = 0.15;

/** Nivel deseado para una altura en pantalla, con histéresis respecto al nivel actual. */
export function lodLevelFor(px: number, current: number, levels: number, minLevel = 0): number {
  const up = (i: number) => LOD_PX[i] * (current > i ? 1 + LOD_HYSTERESIS : 1 - LOD_HYSTERESIS);
  let level = px >= up(0) ? 0 : px >= up(1) ? 1 : 2;
  level = Math.max(level, minLevel);
  return Math.min(level, levels - 1);
}

const frustum = new Frustum(), projView = new Matrix4(), sphere = new Sphere();

function LodPreload({ url, onReady }: { url: string; onReady: () => void }) {
  const gltf = useGLTF(url);
  useEffect(() => {
    loaded.set(url, gltf);
    onReady();
  }, [gltf, url, onReady]);
  return null;
}

/**
 * Trabajador con niveles de detalle. El nivel visible solo cambia cuando el
 * nuevo ya está cargado (sin huecos ni parpadeos); en móvil no pasa de LOD1.
 */
export function StaffModelLod(props: { model: StaffModelSpec; avatar: AvatarSpec; look: SceneLook; reducedMotion: boolean; compact: boolean }) {
  const { model, compact } = props;
  const urls = useMemo(() => [model.url, ...(model.lods ?? [])], [model.url, model.lods]);
  const minLevel = compact && urls.length > 1 ? 1 : 0;
  // Solo en desarrollo: «?lod=0|1|2» fija el nivel para comparar capturas.
  const forced = useMemo(() => {
    if (process.env.NODE_ENV === "production" || typeof window === "undefined") return null;
    const v = new URLSearchParams(window.location.search).get("lod");
    return v === "0" || v === "1" || v === "2" ? Math.min(+v, urls.length - 1) : null;
  }, [urls.length]);
  const camera = useThree((s) => s.camera) as OrthographicCamera;
  // Altura aproximada del trabajador sentado, en metros.
  const seated = model.height * model.scale * 0.72;
  const [want, setWant] = useState(() => forced ?? lodLevelFor(camera.zoom * seated, 2, urls.length, minLevel));
  const [shown, setShown] = useState(want);
  const wantRef = useRef(want);
  const holder = useRef<Group>(null);
  useFrame(() => {
    if (forced !== null || !holder.current) return;
    // Fuera de la cámara no hace falta más detalle: se queda en el nivel más ligero (no se descarga el detallado).
    projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projView);
    holder.current.getWorldPosition(sphere.center);
    sphere.center.y += seated / 2;
    sphere.radius = seated;
    const visible = frustum.intersectsSphere(sphere);
    const next = visible ? lodLevelFor(camera.zoom * seated, wantRef.current, urls.length, minLevel) : urls.length - 1;
    if (next !== wantRef.current) {
      wantRef.current = next;
      setWant(next);
    }
  });
  const ready = useMemo(() => () => setShown(want), [want]);
  return (
    <group ref={holder} userData={{ dynamic: true, lod: shown }}>
      <StaffModel {...props} model={{ ...model, url: urls[shown] }} />
      {want !== shown && (
        <Suspense fallback={null}>
          <LodPreload url={urls[want]} onReady={ready} />
        </Suspense>
      )}
    </group>
  );
}

export function StaffModel({ model, avatar, look, reducedMotion }: { model: StaffModelSpec; avatar: AvatarSpec; look: SceneLook; reducedMotion: boolean }) {
  const gltf = useGLTF(model.url);
  useEffect(() => void loaded.set(model.url, gltf), [model.url, gltf]);
  const invalidate = useThree((s) => s.invalidate);
  // Cada puesto tiene su copia del esqueleto; la geometría se comparte desde la caché.
  const root = useMemo(() => cloneSkinned(gltf.scene) as Group, [gltf.scene]);
  const bones = useMemo(() => findPoseBones(root, model.rig ?? "quaternius", model.url), [root, model.rig, model.url]);
  // Altura de la cadera de pie, medida en el propio modelo (sirve para cualquier esqueleto).
  const hipsY = useMemo(() => {
    root.updateMatrixWorld(true);
    return bones.Hips.getWorldPosition(new Vector3()).y;
  }, [root, bones]);
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
      // Los modelos realistas traen sus propios valores de material (postproceso); los low-poly, no.
      if ((model.rig ?? "quaternius") === "quaternius") {
        m.roughness = /Eye/.test(src.name) ? 0.25 : 0.7;
        m.metalness = 0;
      }
      if (look.inactive) {
        // Inactivo (fuera del piloto). Low-poly: gris uniforme. Realista: el gris dejaría una mancha oscura sobre la
        // textura, así que se atenúa (40 % menos de luz) y sigue siendo reconocible. Ninguno se anima.
        if ((model.rig ?? "quaternius") === "quaternius") m.color.copy(/Skin/.test(src.name) ? OFF_SKIN : OFF_CLOTH).multiplyScalar(0.6 + m.color.getHSL({ h: 0, s: 0, l: 0 }).l * 0.6);
        else m.color.multiplyScalar(0.6);
      }
      mesh.material = m;
      owned.push(m);
    });
    invalidate();
    return () => owned.forEach((m) => m.dispose());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo importan piel y pelo, no la identidad del objeto
  }, [root, model.tint, model.rig, avatar.skin, avatar.hair, look.inactive, invalidate]);

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
