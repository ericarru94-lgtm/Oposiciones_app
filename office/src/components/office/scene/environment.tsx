"use client";

// Arquitectura de la sede: suelo de microcemento pulido, muros cortina de
// vidrio con vistas nocturnas, iluminación lineal arquitectónica, sala de
// reuniones acristalada, zona de descanso, recepción con la marca y
// jardineras en los pasillos. Todo estático (se fusiona en pocas mallas).

import { RoundedBox } from "./rounded";
import { LOUNGE, MEETING, OFFICE_SIZE } from "@/lib/office/layout";
import { brandWallTexture, floorTexture, rugTexture, screenTexture, windowTexture } from "./textures";

const W = OFFICE_SIZE.w;
const D = OFFICE_SIZE.d;
const WALL_H = 3.4;
const FRAME = "#c9d0dc";
const DARK = "#1b2130";

function Plant({ p, s = 1 }: { p: [number, number, number]; s?: number }) {
  return (
    <group position={p} scale={s}>
      <mesh position={[0, 0.35, 0]} castShadow><cylinderGeometry args={[0.32, 0.26, 0.7, 24]} /><meshStandardMaterial color="#e6e1d6" roughness={0.6} /></mesh>
      {[[0, 1.15, 0, 0.55], [0.25, 1.6, 0.12, 0.38], [-0.28, 1.5, -0.1, 0.36], [0.06, 1.95, -0.12, 0.28]].map(([x, y, z, r], i) => (
        <mesh key={i} position={[x, y, z]} castShadow><icosahedronGeometry args={[r, 1]} /><meshStandardMaterial color={["#2f7a4f", "#3d9461", "#27693f", "#4aa36e"][i]} roughness={0.75} /></mesh>
      ))}
    </group>
  );
}

/** Jardinera alargada de pasillo con vegetación baja. */
function Planter({ p, len, r = 0 }: { p: [number, number, number]; len: number; r?: number }) {
  return (
    <group position={p} rotation-y={r}>
      <RoundedBox args={[len, 0.55, 0.6]} radius={0.05} position={[0, 0.28, 0]} castShadow receiveShadow><meshStandardMaterial color="#2a3142" roughness={0.5} /></RoundedBox>
      {Array.from({ length: Math.round(len / 0.55) }, (_, i) => (
        <mesh key={i} position={[-len / 2 + 0.3 + i * 0.55, 0.72, (i % 2) * 0.08 - 0.04]} castShadow>
          <icosahedronGeometry args={[0.3 + (i % 3) * 0.05, 1]} />
          <meshStandardMaterial color={["#2f7a4f", "#3d9461", "#27693f"][i % 3]} roughness={0.75} />
        </mesh>
      ))}
    </group>
  );
}

/** Muro cortina: vidrio con vistas, montantes cada 2,5 m y tira de luz en el zócalo. */
function CurtainWall({ len, p, r = 0 }: { len: number; p: [number, number, number]; r?: number }) {
  const panels = Math.round(len / 2.5);
  return (
    <group position={p} rotation-y={r}>
      <mesh position={[0, WALL_H / 2, -0.1]}><boxGeometry args={[len, WALL_H, 0.15]} /><meshStandardMaterial color={DARK} roughness={0.9} /></mesh>
      <mesh position={[0, WALL_H / 2 + 0.1, 0]}>
        <planeGeometry args={[len - 0.2, WALL_H - 0.6]} />
        <meshStandardMaterial map={windowTexture()} emissiveMap={windowTexture()} emissive="#ffffff" emissiveIntensity={0.55} roughness={0.1} metalness={0.2} toneMapped={false} />
      </mesh>
      {Array.from({ length: panels + 1 }, (_, i) => (
        <mesh key={i} position={[-len / 2 + (i * len) / panels, WALL_H / 2, 0.04]}><boxGeometry args={[0.07, WALL_H, 0.1]} /><meshStandardMaterial color={FRAME} metalness={0.7} roughness={0.3} /></mesh>
      ))}
      <mesh position={[0, WALL_H - 0.12, 0.05]}><boxGeometry args={[len, 0.12, 0.12]} /><meshStandardMaterial color={FRAME} metalness={0.7} roughness={0.3} /></mesh>
      <mesh position={[0, 0.12, 0.05]}><boxGeometry args={[len, 0.24, 0.12]} /><meshStandardMaterial color={DARK} /></mesh>
      {/* Luz lineal del zócalo */}
      <mesh position={[0, 0.26, 0.12]}><boxGeometry args={[len, 0.02, 0.02]} /><meshStandardMaterial color="#9fb4ff" emissive="#9fb4ff" emissiveIntensity={1.4} toneMapped={false} /></mesh>
    </group>
  );
}

function MeetingRoom() {
  const glass = <meshPhysicalMaterial color="#b9c8ff" transparent opacity={0.14} roughness={0.04} metalness={0.1} envMapIntensity={1.4} />;
  const frame = <meshStandardMaterial color={FRAME} metalness={0.7} roughness={0.25} />;
  const H = 2.7;
  const { w, d } = MEETING;
  return (
    <group position={[MEETING.x, 0, MEETING.z]}>
      <mesh position={[0, 0.02, 0]} receiveShadow><boxGeometry args={[w, 0.04, d]} /><meshStandardMaterial map={rugTexture()} roughness={0.95} /></mesh>
      {/* Vidrio en los cuatro lados con puerta frontal */}
      {[[0, -d / 2, w, 0.05], [-w / 2, 0, 0.05, d], [w / 2, 0, 0.05, d]].map(([x, z, ww, dd], i) => (
        <group key={i}>
          <mesh position={[x, H / 2, z]}><boxGeometry args={[ww, H, dd]} />{glass}</mesh>
          <mesh position={[x, H, z]}><boxGeometry args={[ww || 0.08, 0.06, dd || 0.08]} />{frame}</mesh>
        </group>
      ))}
      {[-1, 1].map((s) => (
        <group key={s}>
          <mesh position={[s * (w / 4 + 0.6), H / 2, d / 2]}><boxGeometry args={[w / 2 - 1.2, H, 0.05]} />{glass}</mesh>
          <mesh position={[s * (w / 4 + 0.6), H, d / 2]}><boxGeometry args={[w / 2 - 1.2, 0.06, 0.08]} />{frame}</mesh>
        </group>
      ))}
      {[[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]].map(([x, z], i) => (
        <mesh key={i} position={[x, H / 2, z]}><boxGeometry args={[0.08, H, 0.08]} />{frame}</mesh>
      ))}
      {/* Mesa de reuniones con tapa de roble y diez sillas */}
      <RoundedBox args={[5.2, 0.08, 1.8]} radius={0.04} smoothness={3} position={[0, 0.76, 0.2]} castShadow receiveShadow>
        <meshStandardMaterial color="#a07a55" roughness={0.4} />
      </RoundedBox>
      {[-1.8, 1.8].map((x) => <mesh key={x} position={[x, 0.37, 0.2]}><boxGeometry args={[0.1, 0.72, 1.2]} /><meshStandardMaterial color="#2a3142" metalness={0.6} roughness={0.3} /></mesh>)}
      {[-2, -1, 0, 1, 2].flatMap((x) => [-1, 1].map((s) => (
        <group key={`${x}${s}`} position={[x * 1.0, 0, 0.2 + s * 1.25]} rotation-y={s > 0 ? Math.PI : 0}>
          <RoundedBox args={[0.55, 0.08, 0.5]} radius={0.03} position={[0, 0.48, 0]} castShadow><meshStandardMaterial color="#3a4256" roughness={0.85} /></RoundedBox>
          <RoundedBox args={[0.52, 0.55, 0.07]} radius={0.03} position={[0, 0.8, 0.24]} castShadow><meshStandardMaterial color="#3a4256" roughness={0.85} /></RoundedBox>
          <mesh position={[0, 0.24, 0]}><cylinderGeometry args={[0.03, 0.03, 0.44, 8]} /><meshStandardMaterial color="#9aa3b5" metalness={0.8} /></mesh>
        </group>
      )))}
      {/* Pantalla de la sala */}
      <group position={[0, 1.55, -d / 2 + 0.12]}>
        <mesh position={[0, 0, -0.03]}><boxGeometry args={[3.2, 1.85, 0.06]} /><meshStandardMaterial color="#0b0d12" roughness={0.3} /></mesh>
        <mesh><planeGeometry args={[3.05, 1.72]} /><meshStandardMaterial map={screenTexture("org")} emissiveMap={screenTexture("org")} emissive="#ffffff" emissiveIntensity={0.2} toneMapped={false} /></mesh>
      </group>
      {/* Lámparas lineales colgantes */}
      {[-1.4, 1.4].map((x) => (
        <group key={x} position={[x, 2.35, 0.2]}>
          {[-0.9, 0.9].map((z) => <mesh key={z} position={[0, 0.5, z]}><cylinderGeometry args={[0.006, 0.006, 1, 4]} /><meshStandardMaterial color="#2a3142" /></mesh>)}
          <mesh><boxGeometry args={[0.12, 0.06, 2]} /><meshStandardMaterial color="#1b2130" metalness={0.5} /></mesh>
          <mesh position={[0, -0.035, 0]}><boxGeometry args={[0.08, 0.01, 1.9]} /><meshStandardMaterial color="#fff1d6" emissive="#ffd9a0" emissiveIntensity={1.6} toneMapped={false} /></mesh>
        </group>
      ))}
    </group>
  );
}

function Lounge() {
  return (
    <group position={[LOUNGE.x, 0, LOUNGE.z]}>
      <mesh position={[0, 0.012, 0]} receiveShadow><boxGeometry args={[LOUNGE.w, 0.024, LOUNGE.d]} /><meshStandardMaterial color="#4a3f39" roughness={0.98} /></mesh>
      {/* Sofá en L */}
      <group position={[-1.2, 0, 0.6]}>
        <RoundedBox args={[3.4, 0.42, 0.9]} radius={0.1} position={[0, 0.32, 0]} castShadow><meshStandardMaterial color="#c6c1b6" roughness={0.9} /></RoundedBox>
        <RoundedBox args={[3.4, 0.55, 0.22]} radius={0.08} position={[0, 0.68, 0.38]} castShadow><meshStandardMaterial color="#c6c1b6" roughness={0.9} /></RoundedBox>
        <RoundedBox args={[0.9, 0.42, 1.8]} radius={0.1} position={[-1.25, 0.32, -0.85]} castShadow><meshStandardMaterial color="#c6c1b6" roughness={0.9} /></RoundedBox>
        {[-0.8, 0.2].map((x) => <RoundedBox key={x} args={[0.45, 0.4, 0.14]} radius={0.06} position={[x, 0.65, 0.22]} rotation-x={-0.25}><meshStandardMaterial color={x < 0 ? "#2747f5" : "#ff4b2b"} roughness={0.9} /></RoundedBox>)}
      </group>
      <mesh position={[0.4, 0.24, -0.4]} castShadow><cylinderGeometry args={[0.55, 0.55, 0.06, 32]} /><meshStandardMaterial color="#a07a55" roughness={0.4} /></mesh>
      <mesh position={[0.4, 0.12, -0.4]}><cylinderGeometry args={[0.06, 0.15, 0.22, 12]} /><meshStandardMaterial color="#1b2130" /></mesh>
      <Plant p={[2.9, 0, 1]} s={1.05} />
    </group>
  );
}

function Reception() {
  return (
    <group position={[-12.5, 0, 13.2]}>
      <RoundedBox args={[4, 1.1, 0.9]} radius={0.12} position={[0, 0.55, 0]} castShadow receiveShadow><meshStandardMaterial color="#e9e6df" roughness={0.35} /></RoundedBox>
      <mesh position={[0, 0.6, 0.46]}><planeGeometry args={[2.4, 0.6]} /><meshStandardMaterial map={brandWallTexture()} emissiveMap={brandWallTexture()} emissive="#ffffff" emissiveIntensity={0.3} toneMapped={false} /></mesh>
      <mesh position={[0, 1.12, 0]}><boxGeometry args={[4.05, 0.04, 0.95]} /><meshStandardMaterial color="#a07a55" roughness={0.4} /></mesh>
      <mesh position={[0, 0.04, 0.47]}><boxGeometry args={[3.9, 0.02, 0.02]} /><meshStandardMaterial color="#ff4b2b" emissive="#ff4b2b" emissiveIntensity={1.2} toneMapped={false} /></mesh>
    </group>
  );
}

export function Environment() {
  return (
    <group>
      {/* Suelo de microcemento pulido (refleja el entorno) y zócalo de la planta */}
      <mesh rotation-x={-Math.PI / 2} position-y={-0.005} receiveShadow>
        <planeGeometry args={[W, D]} />
        <meshStandardMaterial map={floorTexture()} roughness={0.32} metalness={0.05} envMapIntensity={0.9} />
      </mesh>
      <mesh position={[0, -0.25, 0]}><boxGeometry args={[W + 0.4, 0.48, D + 0.4]} /><meshStandardMaterial color="#0b0e16" /></mesh>
      {/* Pasillos marcados por una franja de luz empotrada */}
      {[-8.8, 8.8].map((x) => (
        <mesh key={x} position={[x, 0.004, 0]}><boxGeometry args={[0.04, 0.006, D - 6]} /><meshStandardMaterial color="#5b7bff" emissive="#5b7bff" emissiveIntensity={0.9} toneMapped={false} /></mesh>
      ))}

      {/* Muros cortina en el fondo y en el lado oeste; muro de marca en el fondo */}
      <CurtainWall len={W} p={[0, 0, -D / 2]} />
      <CurtainWall len={D} p={[-W / 2, 0, 0]} r={Math.PI / 2} />
      <group position={[0, 0, -D / 2 + 0.15]}>
        <mesh position={[0, WALL_H / 2, 0]}><boxGeometry args={[11.6, WALL_H, 0.12]} /><meshStandardMaterial color="#202737" roughness={0.6} /></mesh>
        <mesh position={[0, 2.45, 0.07]}><planeGeometry args={[4.6, 1.15]} /><meshStandardMaterial map={brandWallTexture()} emissiveMap={brandWallTexture()} emissive="#ffffff" emissiveIntensity={0.25} toneMapped={false} /></mesh>
      </group>

      <MeetingRoom />
      <Lounge />
      <Reception />

      {/* Jardineras de pasillo y plantas grandes en las esquinas */}
      {[-6.2, 6.2].map((z) => <Planter key={`w${z}`} p={[-8.8, 0, z / 1.6]} len={2.6} r={Math.PI / 2} />)}
      {[-6.2, 6.2].map((z) => <Planter key={`e${z}`} p={[8.8, 0, z / 1.6]} len={2.6} r={Math.PI / 2} />)}
      <Planter p={[-1.2, 0, 7.4]} len={6.5} />
      <Plant p={[-W / 2 + 1, 0, -D / 2 + 1]} s={1.2} />
      <Plant p={[W / 2 - 1, 0, -D / 2 + 1]} s={1.1} />
      <Plant p={[-W / 2 + 1, 0, D / 2 - 1]} s={1.1} />
      <Plant p={[-7, 0, -13.6]} s={1} />
      <Plant p={[7, 0, -13.6]} s={1} />
      {/* Punto de café en el fondo */}
      <group position={[-12, 0, -13.9]}>
        <RoundedBox args={[3, 0.95, 0.65]} radius={0.04} position={[0, 0.48, 0]} castShadow><meshStandardMaterial color="#2a3142" roughness={0.5} /></RoundedBox>
        <mesh position={[0, 0.98, 0]}><boxGeometry args={[3.05, 0.05, 0.7]} /><meshStandardMaterial color="#e9e6df" roughness={0.3} /></mesh>
        <mesh position={[-0.9, 1.25, -0.05]}><boxGeometry args={[0.4, 0.5, 0.4]} /><meshStandardMaterial color="#0b0d12" metalness={0.4} /></mesh>
        {[0.3, 0.55, 0.8].map((x) => <mesh key={x} position={[x, 1.06, 0.1]}><cylinderGeometry args={[0.045, 0.04, 0.1, 12]} /><meshStandardMaterial color="#f4f5f7" /></mesh>)}
      </group>
    </group>
  );
}
