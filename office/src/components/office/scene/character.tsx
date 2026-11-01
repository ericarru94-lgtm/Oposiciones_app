"use client";

// Trabajador 3D estilizado, sentado en su puesto (mira hacia -z, al monitor).
// La animación es una función del tiempo y del estado REAL (agents.status):
// nunca hay temporizadores ni estados inventados. Un agente inactivo es una
// figura apagada y quieta, que se fusiona con el mobiliario estático.

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { DoubleSide, LatheGeometry, Vector2, type Group, type Mesh, type MeshStandardMaterial } from "three";
import type { AvatarSpec } from "@/lib/agents/catalog";
import type { SceneLook } from "@/lib/office/scene";
import { Baked } from "./baked";

/** Vestuario de cada trabajador (presentación): prenda superior, chaqueta, pantalón y zapatos. */
const WARDROBE: Record<string, { shirt?: string; jacket?: string; pants: string; shoes: string; tie?: boolean }> = {
  alex: { shirt: "#f1f3f7", jacket: "#141a2b", pants: "#141a2b", shoes: "#0b0d12", tie: true },
  marcus: { pants: "#1f2937", shoes: "#f1f3f7" },
  sofia: { pants: "#2b3245", shoes: "#c46a3a" },
  daniel: { pants: "#3b3f4c", shoes: "#5b4636" },
  lucia: { pants: "#111827", shoes: "#f1f3f7" },
  david: { pants: "#1f2937", shoes: "#0b0d12" },
  emma: { pants: "#334155", shoes: "#e5e7eb" },
  oscar: { shirt: "#dbe4f3", jacket: "#5d6677", pants: "#3b4252", shoes: "#2a1f17" },
  victoria: { shirt: "#f5f5f4", jacket: "#0f172a", pants: "#0f172a", shoes: "#0b0d12" },
};

const OFF = { skin: "#5d6372", hair: "#2c313c", cloth: "#3e4454", dark: "#30353f" };

/** Torso por revolución: cintura → pecho → hombros (y = 0 en la cintura). */
function torsoGeometry(scale: number, open = false) {
  const pts = [
    [0.0, 0.0], [0.15, 0.0], [0.165, 0.08], [0.185, 0.2], [0.2, 0.3], [0.205, 0.38], [0.19, 0.44], [0.13, 0.49], [0.07, 0.51], [0.0, 0.51],
  ].map(([r, y]) => new Vector2(r * scale, y));
  // Chaqueta abierta por delante (la parte delantera mira a -z, phi = π).
  return open ? new LatheGeometry(pts, 28, Math.PI + 0.32, Math.PI * 2 - 0.64) : new LatheGeometry(pts, 28);
}

function Hair({ style, color }: { style: AvatarSpec["hairStyle"]; color: string }) {
  const m = <meshStandardMaterial color={color} roughness={0.75} />;
  const cap = (sy = 0.62, y = 0.07) => (
    <mesh position={[0, y, 0.015]} scale={[1.07, sy, 1.07]}><sphereGeometry args={[0.215, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.62]} />{m}</mesh>
  );
  switch (style) {
    case "bun":
      return (<group>{cap()}<mesh position={[0, 0.2, 0.13]}><sphereGeometry args={[0.09, 16, 12]} />{m}</mesh></group>);
    case "long":
      return (
        <group>
          {cap(0.7)}
          <mesh position={[0, -0.1, 0.1]} scale={[1, 1, 0.55]}><capsuleGeometry args={[0.2, 0.22, 6, 18]} />{m}</mesh>
          {[-1, 1].map((s) => <mesh key={s} position={[0.19 * s, -0.06, -0.02]} scale={[0.5, 1, 0.8]}><capsuleGeometry args={[0.07, 0.24, 4, 10]} />{m}</mesh>)}
        </group>
      );
    case "wavy":
      return (
        <group>
          {cap(0.72)}
          {[-0.14, 0, 0.14].map((x, i) => <mesh key={x} position={[x, -0.08 - (i % 2) * 0.03, 0.12]}><sphereGeometry args={[0.1, 14, 10]} />{m}</mesh>)}
          {[-1, 1].map((s) => <mesh key={s} position={[0.2 * s, -0.04, 0]}><sphereGeometry args={[0.085, 12, 10]} />{m}</mesh>)}
        </group>
      );
    case "ponytail":
      return (
        <group>
          {cap()}
          <mesh position={[0, 0.02, 0.22]}><sphereGeometry args={[0.05, 10, 8]} /><meshStandardMaterial color="#ff4b2b" /></mesh>
          <mesh position={[0, -0.12, 0.27]} rotation-x={0.35}><capsuleGeometry args={[0.055, 0.26, 4, 10]} />{m}</mesh>
        </group>
      );
    case "curly":
      return (
        <group>
          {[[0, 0.16, 0], [-0.12, 0.12, 0.05], [0.12, 0.12, 0.05], [-0.15, 0.04, 0.1], [0.15, 0.04, 0.1], [0, 0.12, 0.13], [-0.08, 0.18, -0.06], [0.08, 0.18, -0.06]].map(([x, y, z], i) => (
            <mesh key={i} position={[x, y, z]}><sphereGeometry args={[0.095, 12, 10]} />{m}</mesh>
          ))}
        </group>
      );
    case "buzz":
      return <mesh position={[0, 0.045, 0.01]} scale={[1.02, 0.6, 1.02]}><sphereGeometry args={[0.21, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.55]} />{m}</mesh>;
    case "side":
      return (
        <group>
          {cap(0.6)}
          <mesh position={[-0.06, 0.15, -0.1]} rotation={[0.4, 0, 0.35]} scale={[1.4, 0.5, 1]}><sphereGeometry args={[0.1, 14, 10]} />{m}</mesh>
        </group>
      );
    default:
      return (
        <group>
          {cap(0.6)}
          <mesh position={[0, 0.13, -0.12]} scale={[1.6, 0.45, 0.8]}><sphereGeometry args={[0.09, 14, 10]} />{m}</mesh>
        </group>
      );
  }
}

function Head({ avatar, inactive, eyes }: { avatar: AvatarSpec; inactive: boolean; eyes: boolean }) {
  const skin = inactive ? OFF.skin : avatar.skin;
  const hair = inactive ? OFF.hair : avatar.hair;
  const skinM = <meshStandardMaterial color={skin} roughness={0.55} />;
  return (
    <group>
      {/* Cráneo y mandíbula */}
      <mesh scale={[1, 1.06, 1.02]}><sphereGeometry args={[0.2, 32, 24]} />{skinM}</mesh>
      <mesh position={[0, -0.09, -0.06]} scale={[0.82, 0.6, 0.8]}><sphereGeometry args={[0.16, 24, 16]} />{skinM}</mesh>
      {/* Orejas y nariz */}
      {[-1, 1].map((s) => <mesh key={s} position={[0.198 * s, -0.01, 0.01]} scale={[0.45, 1, 0.75]}><sphereGeometry args={[0.05, 12, 10]} />{skinM}</mesh>)}
      <mesh position={[0, -0.03, -0.205]} scale={[0.75, 1, 1]}><sphereGeometry args={[0.03, 12, 10]} />{skinM}</mesh>
      {eyes && (
        <group>
          {/* Ojos: blanco, iris y brillo */}
          {[-1, 1].map((s) => (
            <group key={s} position={[0.072 * s, 0.025, -0.178]}>
              <mesh scale={[1, 0.9, 0.6]}><sphereGeometry args={[0.034, 16, 12]} /><meshStandardMaterial color="#f8fafc" roughness={0.2} /></mesh>
              <mesh position={[0, -0.002, -0.017]}><sphereGeometry args={[0.019, 12, 10]} /><meshStandardMaterial color="#2b1d14" roughness={0.15} /></mesh>
              <mesh position={[0.007, 0.006, -0.032]}><sphereGeometry args={[0.005, 6, 6]} /><meshBasicMaterial color="#ffffff" /></mesh>
              {/* Ceja */}
              <mesh position={[0, 0.05, -0.008]} rotation-z={0.12 * s}><boxGeometry args={[0.058, 0.012, 0.012]} /><meshStandardMaterial color={hair} /></mesh>
            </group>
          ))}
          {/* Boca */}
          <mesh position={[0, -0.095, -0.17]} rotation={[0.2, 0, Math.PI]}>
            <torusGeometry args={[0.03, 0.007, 6, 14, Math.PI]} />
            <meshStandardMaterial color="#9a4a4a" roughness={0.6} />
          </mesh>
        </group>
      )}
      <Hair style={avatar.hairStyle} color={hair} />
    </group>
  );
}

export function Character({ agentId, avatar, look, reducedMotion }: { agentId: string; avatar: AvatarSpec; look: SceneLook; reducedMotion: boolean }) {
  const head = useRef<Group>(null);
  const armL = useRef<Group>(null);
  const armR = useRef<Group>(null);
  const foreL = useRef<Group>(null);
  const foreR = useRef<Group>(null);
  const torso = useRef<Group>(null);
  const halo = useRef<MeshStandardMaterial>(null);
  const dots = useRef<Group>(null);
  const inactive = look.inactive;
  const w = WARDROBE[agentId] ?? { pants: "#1f2937", shoes: "#0b0d12" };
  const top = inactive ? OFF.cloth : w.shirt ?? avatar.outfit;
  const jacket = w.jacket ? (inactive ? OFF.dark : w.jacket) : null;
  const pants = inactive ? OFF.dark : w.pants;
  const shoes = inactive ? OFF.dark : w.shoes;
  const skin = inactive ? OFF.skin : avatar.skin;
  const sleeve = jacket ?? top;
  const torsoGeo = useMemo(() => torsoGeometry(1), []);
  const jacketGeo = useMemo(() => torsoGeometry(1.07, true), []);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const on = look.animated && !reducedMotion;
    const typing = on && look.pose === "typing";
    if (armL.current && armR.current && foreL.current && foreR.current) {
      armL.current.rotation.x = -0.55;
      armR.current.rotation.x = look.pose === "thinking" ? -1.25 : -0.55;
      foreL.current.rotation.x = -1.05 + (typing ? Math.sin(t * 11) * 0.12 : 0);
      foreR.current.rotation.x = look.pose === "thinking" ? -1.95 : -1.05 + (typing ? Math.sin(t * 11 + Math.PI) * 0.12 : 0);
    }
    if (head.current) {
      head.current.rotation.z = on && look.pose === "thinking" ? Math.sin(t * 1.4) * 0.09 : 0;
      head.current.rotation.x =
        look.pose === "reading" ? 0.2 : look.pose === "off" ? 0.3 : look.pose === "alert" ? 0.15 : look.pose === "done" ? -0.1 : 0.06;
      head.current.rotation.y = on && look.pose === "reading" ? Math.sin(t * 0.9) * 0.16 : 0;
    }
    if (torso.current) torso.current.position.y = on ? 0.6 + Math.sin(t * 2) * 0.005 : 0.6;
    if (dots.current) {
      dots.current.visible = look.pose === "thinking";
      dots.current.children.forEach((d, i) => (d.position.y = on ? Math.max(0, Math.sin(t * 3 - i * 0.6)) * 0.05 : 0));
    }
    if (halo.current) halo.current.emissiveIntensity = on ? 0.9 + Math.sin(t * 3) * 0.4 : inactive ? 0 : 0.6;
  });

  const dyn = { dynamic: !inactive };
  const bakeKey = `${agentId}-${inactive}`;
  const pantsM = <meshStandardMaterial color={pants} roughness={0.8} />;

  return (
    <group scale={1.18}>
      {/* Piernas sentadas: muslo hacia delante, espinilla vertical y zapato */}
      {[-0.1, 0.1].map((x) => (
        <group key={x}>
          <mesh position={[x, 0.5, -0.17]} rotation-x={Math.PI / 2}><capsuleGeometry args={[0.072, 0.3, 6, 14]} />{pantsM}</mesh>
          <mesh position={[x, 0.27, -0.36]}><capsuleGeometry args={[0.06, 0.34, 6, 14]} />{pantsM}</mesh>
          <mesh position={[x, 0.04, -0.41]} scale={[1, 0.6, 1.6]}><sphereGeometry args={[0.07, 14, 10]} /><meshStandardMaterial color={shoes} roughness={0.35} /></mesh>
        </group>
      ))}
      <group ref={torso} position={[0, 0.6, 0]} userData={dyn}>
        <Baked version={bakeKey}>
          {/* Cadera, torso, chaqueta abierta, cuello de camisa, corbata y acreditación */}
          <mesh position={[0, -0.04, 0]} scale={[1, 0.6, 0.85]}><sphereGeometry args={[0.16, 20, 14]} />{pantsM}</mesh>
          <mesh geometry={torsoGeo} scale={[1, 1, 0.78]}><meshStandardMaterial color={top} roughness={0.8} /></mesh>
          {jacket && <mesh geometry={jacketGeo} scale={[1, 1, 0.8]}><meshStandardMaterial color={jacket} roughness={0.7} side={DoubleSide} /></mesh>}
          <mesh position={[0, 0.5, -0.02]} rotation-x={Math.PI / 2}><torusGeometry args={[0.07, 0.022, 8, 18]} /><meshStandardMaterial color={inactive ? OFF.cloth : w.shirt ?? avatar.accent} roughness={0.7} /></mesh>
          {w.tie && <mesh position={[0, 0.34, -0.155]} rotation-x={-0.12}><boxGeometry args={[0.045, 0.24, 0.015]} /><meshStandardMaterial color={inactive ? OFF.dark : avatar.accent} /></mesh>}
          <mesh position={[0.09, 0.32, -0.162]}><boxGeometry args={[0.05, 0.065, 0.008]} /><meshStandardMaterial color={inactive ? OFF.dark : "#ff4b2b"} emissive={inactive ? "#000" : "#ff4b2b"} emissiveIntensity={0.25} /></mesh>
          <mesh position={[0, 0.56, 0]}><cylinderGeometry args={[0.055, 0.065, 0.1, 14]} /><meshStandardMaterial color={skin} roughness={0.55} /></mesh>
        </Baked>
        {/* Brazos: hombro → codo → antebrazo hacia el teclado → mano con pulgar */}
        {[-1, 1].map((s) => (
          <group key={s} ref={s < 0 ? armL : armR} position={[0.215 * s, 0.43, 0]} rotation-x={-0.55}>
            <mesh><sphereGeometry args={[0.07, 14, 10]} /><meshStandardMaterial color={sleeve} roughness={0.75} /></mesh>
            <mesh position={[0, -0.13, 0]}><capsuleGeometry args={[0.055, 0.2, 4, 12]} /><meshStandardMaterial color={sleeve} roughness={0.75} /></mesh>
            <group ref={s < 0 ? foreL : foreR} position={[0, -0.26, 0]} rotation-x={-1.05}>
              <mesh position={[0, -0.11, 0]}><capsuleGeometry args={[0.048, 0.18, 4, 12]} /><meshStandardMaterial color={sleeve} roughness={0.75} /></mesh>
              {avatar.accessory === "watch" && s > 0 && !inactive && (
                <mesh position={[0, -0.2, 0]} rotation-x={Math.PI / 2}><torusGeometry args={[0.05, 0.012, 6, 16]} /><meshStandardMaterial color="#c9a227" metalness={0.8} roughness={0.25} /></mesh>
              )}
              <mesh position={[0, -0.26, -0.01]} scale={[1, 1.15, 0.6]}><sphereGeometry args={[0.052, 14, 10]} /><meshStandardMaterial color={skin} roughness={0.55} /></mesh>
              <mesh position={[0.04 * -s, -0.24, -0.03]} rotation-z={0.6 * s}><capsuleGeometry args={[0.016, 0.04, 3, 8]} /><meshStandardMaterial color={skin} roughness={0.55} /></mesh>
            </group>
          </group>
        ))}
        <group ref={head} position={[0, 0.81, 0]}>
          <Baked version={bakeKey}>
            <Head avatar={avatar} inactive={inactive} eyes={!inactive} />
            {avatar.accessory === "glasses" && (
              <group position={[0, 0.025, -0.205]}>
                {[-0.072, 0.072].map((x) => (
                  <mesh key={x} position={[x, 0, 0]}><torusGeometry args={[0.044, 0.008, 8, 20]} /><meshStandardMaterial color="#0b0d12" metalness={0.3} roughness={0.3} /></mesh>
                ))}
                <mesh><boxGeometry args={[0.06, 0.008, 0.008]} /><meshStandardMaterial color="#0b0d12" /></mesh>
              </group>
            )}
            {avatar.accessory === "headset" && (
              <group>
                <mesh rotation-z={Math.PI / 2}><torusGeometry args={[0.235, 0.016, 8, 24, Math.PI]} /><meshStandardMaterial color={inactive ? OFF.dark : "#1f2937"} /></mesh>
                {[-1, 1].map((s) => <mesh key={s} position={[0.22 * s, -0.02, 0]} rotation-z={Math.PI / 2}><cylinderGeometry args={[0.06, 0.06, 0.05, 16]} /><meshStandardMaterial color={inactive ? OFF.dark : avatar.accent} /></mesh>)}
                <mesh position={[0.17, -0.12, -0.11]} rotation={[0.5, 0.5, 0.3]}><capsuleGeometry args={[0.01, 0.16, 3, 6]} /><meshStandardMaterial color="#1f2937" /></mesh>
              </group>
            )}
            {avatar.accessory === "earring" && !inactive && [-1, 1].map((s) => (
              <mesh key={s} position={[0.2 * s, -0.07, 0.01]}><sphereGeometry args={[0.016, 8, 6]} /><meshStandardMaterial color="#f5b800" metalness={0.8} roughness={0.2} /></mesh>
            ))}
          </Baked>
          {/* Pensando: tres puntos sobre la cabeza */}
          <group ref={dots} position={[0, 0.36, 0]} visible={false} userData={{ dynamic: true }}>
            {[-0.07, 0, 0.07].map((x) => (
              <mesh key={x} position={[x, 0, 0]}><sphereGeometry args={[0.025, 10, 8]} /><meshStandardMaterial color="#f5b800" emissive="#f5b800" emissiveIntensity={0.8} /></mesh>
            ))}
          </group>
        </group>
      </group>
      {/* Aro de estado bajo la silla */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.012} userData={dyn}>
        <ringGeometry args={[0.6, 0.68, 48]} />
        <meshStandardMaterial ref={halo} color={look.ring} emissive={look.ring} emissiveIntensity={0.6} transparent opacity={inactive ? 0.3 : 0.95} />
      </mesh>
    </group>
  );
}

/** Marca flotante del estado (solo estados que lo merecen; fija salvo «esperando aprobación»). */
export function StatusMark({ look, reducedMotion }: { look: SceneLook; reducedMotion: boolean }) {
  const ref = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current && look.pose === "alert" && look.animated && !reducedMotion) {
      ref.current.position.y = 2.35 + Math.sin(clock.getElapsedTime() * 2.5) * 0.04;
    }
  });
  if (look.inactive) return null;
  if (look.pose === "done") {
    return (
      <mesh position={[0, 2.35, 0]}>
        <torusGeometry args={[0.11, 0.028, 8, 24]} />
        <meshStandardMaterial color="#12b76a" emissive="#12b76a" emissiveIntensity={0.7} />
      </mesh>
    );
  }
  if (look.pose === "alert") {
    return (
      <mesh ref={ref} position={[0, 2.35, 0]} rotation-z={Math.PI / 4}>
        <boxGeometry args={[0.17, 0.17, 0.04]} />
        <meshStandardMaterial color={look.ring} emissive={look.ring} emissiveIntensity={0.9} />
      </mesh>
    );
  }
  if (look.pose === "waiting") {
    return (
      <group position={[0, 2.35, 0]}>
        {[0.065, -0.065].map((y) => (
          <mesh key={y} position={[0, y, 0]} rotation-x={y > 0 ? Math.PI : 0}>
            <coneGeometry args={[0.075, 0.12, 12]} />
            <meshStandardMaterial color="#8a91a6" emissive="#8a91a6" emissiveIntensity={0.3} />
          </mesh>
        ))}
      </group>
    );
  }
  return null;
}
