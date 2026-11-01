"use client";

// Arquitectura y decoración de la oficina: suelo, paredes con ventanales,
// muro de marca, sala de reuniones central y plantas. Todo estático.

import { MEETING, OFFICE_SIZE } from "@/lib/office/layout";
import { brandWallTexture, floorTexture, rugTexture, windowTexture } from "./textures";

const W = OFFICE_SIZE.w;
const D = OFFICE_SIZE.d;
const WALL_H = 3.2;

function Plant({ p, s = 1 }: { p: [number, number, number]; s?: number }) {
  return (
    <group position={p} scale={s}>
      <mesh position={[0, 0.3, 0]}><cylinderGeometry args={[0.28, 0.22, 0.6, 14]} /><meshStandardMaterial color="#e2ddd0" roughness={0.9} /></mesh>
      <mesh position={[0, 0.95, 0]}><icosahedronGeometry args={[0.5, 0]} /><meshStandardMaterial color="#2f7a4f" flatShading roughness={0.8} /></mesh>
      <mesh position={[0.18, 1.3, 0.1]}><icosahedronGeometry args={[0.3, 0]} /><meshStandardMaterial color="#3d9461" flatShading roughness={0.8} /></mesh>
      <mesh position={[-0.2, 1.2, -0.08]}><icosahedronGeometry args={[0.26, 0]} /><meshStandardMaterial color="#27693f" flatShading roughness={0.8} /></mesh>
    </group>
  );
}

function Window({ p, r = 0, w }: { p: [number, number, number]; r?: number; w: number }) {
  return (
    <group position={p} rotation-y={r}>
      <mesh position={[0, 0, 0.02]}>
        <planeGeometry args={[w, 1.6]} />
        <meshStandardMaterial map={windowTexture()} emissiveMap={windowTexture()} emissive="#ffffff" emissiveIntensity={0.45} toneMapped={false} />
      </mesh>
      {[-0.8, 0.8].map((y) => (
        <mesh key={y} position={[0, y, 0.04]}><boxGeometry args={[w + 0.1, 0.06, 0.06]} /><meshStandardMaterial color="#2a3142" /></mesh>
      ))}
    </group>
  );
}

export function Environment() {
  return (
    <group>
      {/* Suelo de madera oscura */}
      <mesh rotation-x={-Math.PI / 2} position-y={-0.01} receiveShadow>
        <planeGeometry args={[W, D]} />
        <meshStandardMaterial map={floorTexture()} roughness={0.85} />
      </mesh>
      {/* Zócalo del borde de la planta */}
      <mesh position={[0, -0.15, 0]}>
        <boxGeometry args={[W + 0.3, 0.28, D + 0.3]} />
        <meshStandardMaterial color="#0d111b" />
      </mesh>

      {/* Pared del fondo con ventanales y muro de marca */}
      <group position={[0, WALL_H / 2, -D / 2]}>
        <mesh><boxGeometry args={[W, WALL_H, 0.25]} /><meshStandardMaterial color="#2a3247" roughness={0.9} /></mesh>
        {[-9.2, 9.2].map((x) => <Window key={x} p={[x, 0.2, 0.13]} w={5.4} />)}
        <mesh position={[0, 0.55, 0.14]}>
          <planeGeometry args={[5.2, 1.3]} />
          <meshStandardMaterial map={brandWallTexture()} emissiveMap={brandWallTexture()} emissive="#ffffff" emissiveIntensity={0.25} toneMapped={false} />
        </mesh>
      </group>
      {/* Pared izquierda con ventanales */}
      <group position={[-W / 2, WALL_H / 2, 0]} rotation-y={Math.PI / 2}>
        <mesh><boxGeometry args={[D, WALL_H, 0.25]} /><meshStandardMaterial color="#252c40" roughness={0.9} /></mesh>
        {[-5.5, 0, 5.5].map((x) => <Window key={x} p={[x, 0.2, 0.13]} w={4} />)}
      </group>

      {/* Sala de reuniones central */}
      <group position={[MEETING.x, 0, MEETING.z]}>
        <mesh rotation-x={-Math.PI / 2} position-y={0.005}>
          <planeGeometry args={[MEETING.w + 2.2, MEETING.d + 2.4]} />
          <meshStandardMaterial map={rugTexture()} roughness={1} />
        </mesh>
        <mesh position={[0, 0.74, 0]} scale={[MEETING.w / 2, 1, MEETING.d / 2]}>
          <cylinderGeometry args={[1, 1, 0.06, 40]} />
          <meshStandardMaterial color="#8a6a4f" roughness={0.45} />
        </mesh>
        <mesh position={[0, 0.37, 0]}><cylinderGeometry args={[0.2, 0.32, 0.72, 16]} /><meshStandardMaterial color="#2a3142" /></mesh>
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i / 8) * Math.PI * 2;
          return (
            <group key={i} position={[Math.cos(a) * (MEETING.w / 2 + 0.45), 0, Math.sin(a) * (MEETING.d / 2 + 0.45)]} rotation-y={-a + Math.PI / 2}>
              <mesh position={[0, 0.42, 0]}><boxGeometry args={[0.48, 0.07, 0.46]} /><meshStandardMaterial color="#3a4256" /></mesh>
              <mesh position={[0, 0.7, 0.21]}><boxGeometry args={[0.46, 0.5, 0.06]} /><meshStandardMaterial color="#3a4256" /></mesh>
              <mesh position={[0, 0.21, 0]}><cylinderGeometry args={[0.03, 0.03, 0.4, 8]} /><meshStandardMaterial color="#2a3142" /></mesh>
            </group>
          );
        })}
        {/* Lámparas colgantes */}
        {[-1.1, 0, 1.1].map((x) => (
          <group key={x} position={[x, 2.4, 0]}>
            <mesh position={[0, 0.5, 0]}><cylinderGeometry args={[0.008, 0.008, 1, 4]} /><meshStandardMaterial color="#2a3142" /></mesh>
            <mesh><coneGeometry args={[0.22, 0.2, 18, 1, true]} /><meshStandardMaterial color="#e8ecf8" side={2} /></mesh>
            <mesh position={[0, -0.06, 0]}><sphereGeometry args={[0.07, 10, 8]} /><meshStandardMaterial color="#ffe2b0" emissive="#ffd08a" emissiveIntensity={1.1} toneMapped={false} /></mesh>
          </group>
        ))}
      </group>

      {/* Separadores bajos de vidrio entre las alas y el pasillo */}
      {[-5.6, 5.6].map((x) =>
        [-2, 3].map((z) => (
          <group key={`${x}${z}`} position={[x, 0.55, z]}>
            <mesh><boxGeometry args={[0.04, 1.1, 2.6]} /><meshPhysicalMaterial color="#9fb4ff" transparent opacity={0.1} roughness={0.1} /></mesh>
            <mesh position={[0, 0.55, 0]}><boxGeometry args={[0.06, 0.04, 2.6]} /><meshStandardMaterial color="#c8cfdc" metalness={0.4} roughness={0.4} /></mesh>
            <mesh position={[0, -0.5, 0]}><boxGeometry args={[0.2, 0.1, 2.6]} /><meshStandardMaterial color="#2f7a4f" /></mesh>
          </group>
        )),
      )}

      {/* Plantas en las esquinas y junto a la entrada */}
      <Plant p={[-W / 2 + 0.8, 0, -D / 2 + 0.8]} />
      <Plant p={[W / 2 - 0.8, 0, -D / 2 + 0.8]} s={0.9} />
      <Plant p={[-W / 2 + 0.8, 0, D / 2 - 0.8]} s={0.85} />
      <Plant p={[-4.6, 0, -7.6]} s={0.8} />
      <Plant p={[4.6, 0, -7.6]} s={0.8} />
      {/* Punto de café junto a la pared del fondo */}
      <group position={[-5.3, 0, -9.3]}>
        <mesh position={[0, 0.48, 0]}><boxGeometry args={[1.8, 0.96, 0.6]} /><meshStandardMaterial color="#2a3142" /></mesh>
        <mesh position={[0, 0.98, 0]}><boxGeometry args={[1.85, 0.05, 0.65]} /><meshStandardMaterial color="#8a6a4f" /></mesh>
        <mesh position={[-0.5, 1.2, -0.05]}><boxGeometry args={[0.35, 0.4, 0.35]} /><meshStandardMaterial color="#0b0d12" /></mesh>
      </group>
    </group>
  );
}
