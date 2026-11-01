"use client";

// Personaje original de cada agente, sentado en su puesto. La animación es una
// función del tiempo y del estado REAL (agents.status): nunca hay
// temporizadores ni estados inventados. Un agente inactivo es una figura
// apagada y quieta.

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Group, Mesh, MeshStandardMaterial } from "three";
import type { AvatarSpec } from "@/lib/agents/catalog";
import { Baked } from "./baked";
import type { SceneLook } from "@/lib/office/scene";

const OFF = { skin: "#59606f", hair: "#2b303c", outfit: "#3c4252", accent: "#3c4252" };

function Hair({ style, color }: { style: AvatarSpec["hairStyle"]; color: string }) {
  const m = <meshStandardMaterial color={color} roughness={0.9} flatShading />;
  switch (style) {
    case "bun":
      return (
        <group>
          <mesh position={[0, 0.07, 0.02]} scale={[1.02, 0.62, 1.02]}><sphereGeometry args={[0.2, 12, 10]} />{m}</mesh>
          <mesh position={[0, 0.19, 0.12]}><sphereGeometry args={[0.085, 10, 8]} />{m}</mesh>
        </group>
      );
    case "long":
    case "wavy":
      return (
        <group>
          <mesh position={[0, 0.06, 0.02]} scale={[1.06, 0.66, 1.06]}><sphereGeometry args={[0.2, 12, 10]} />{m}</mesh>
          <mesh position={[0, -0.12, 0.1]} scale={[1, 1, style === "wavy" ? 0.9 : 0.7]}><boxGeometry args={[0.38, 0.32, 0.14]} />{m}</mesh>
        </group>
      );
    case "ponytail":
      return (
        <group>
          <mesh position={[0, 0.06, 0.02]} scale={[1.02, 0.62, 1.02]}><sphereGeometry args={[0.2, 12, 10]} />{m}</mesh>
          <mesh position={[0, -0.04, 0.23]} rotation-x={0.6}><coneGeometry args={[0.06, 0.28, 8]} />{m}</mesh>
        </group>
      );
    case "curly":
      return <mesh position={[0, 0.07, 0.02]} scale={[1.14, 0.78, 1.14]}><icosahedronGeometry args={[0.2, 1]} />{m}</mesh>;
    case "buzz":
      return <mesh position={[0, 0.04, 0.02]} scale={[1, 0.52, 1]}><sphereGeometry args={[0.195, 12, 10]} />{m}</mesh>;
    case "side":
      return (
        <group>
          <mesh position={[0, 0.06, 0.02]} scale={[1.03, 0.58, 1.03]}><sphereGeometry args={[0.2, 12, 10]} />{m}</mesh>
          <mesh position={[0.09, 0.1, -0.08]} rotation-z={-0.4}><boxGeometry args={[0.18, 0.06, 0.16]} />{m}</mesh>
        </group>
      );
    default:
      return <mesh position={[0, 0.06, 0.02]} scale={[1.03, 0.6, 1.03]}><sphereGeometry args={[0.2, 12, 10]} />{m}</mesh>;
  }
}

export function Character({ avatar, look, reducedMotion }: { avatar: AvatarSpec; look: SceneLook; reducedMotion: boolean }) {
  const head = useRef<Group>(null);
  const armL = useRef<Group>(null);
  const armR = useRef<Group>(null);
  const torso = useRef<Group>(null);
  const halo = useRef<MeshStandardMaterial>(null);
  const dots = useRef<Group>(null);
  const c = look.inactive ? OFF : avatar;

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const on = look.animated && !reducedMotion;
    const typing = on && look.pose === "typing";
    if (armL.current && armR.current) {
      armL.current.rotation.x = -1.15 + (typing ? Math.sin(t * 11) * 0.1 : 0);
      armR.current.rotation.x = -1.15 + (typing ? Math.sin(t * 11 + Math.PI) * 0.1 : 0);
      // Pensando: una mano a la barbilla.
      if (look.pose === "thinking") armR.current.rotation.x = -2.2;
    }
    if (head.current) {
      head.current.rotation.z = on && look.pose === "thinking" ? Math.sin(t * 1.4) * 0.1 : 0;
      head.current.rotation.x =
        look.pose === "reading" ? 0.22 : look.pose === "off" ? 0.32 : look.pose === "alert" ? 0.18 : look.pose === "done" ? -0.12 : 0;
      head.current.rotation.y = on && look.pose === "reading" ? Math.sin(t * 0.9) * 0.18 : 0;
    }
    if (torso.current) torso.current.position.y = on ? 0.62 + Math.sin(t * 2) * 0.006 : 0.62;
    if (dots.current) {
      dots.current.visible = look.pose === "thinking";
      dots.current.children.forEach((d, i) => {
        d.position.y = on ? Math.max(0, Math.sin(t * 3 - i * 0.6)) * 0.05 : 0;
      });
    }
    if (halo.current) halo.current.emissiveIntensity = on ? 0.9 + Math.sin(t * 3) * 0.4 : look.inactive ? 0 : 0.6;
  });

  const skinMat = <meshStandardMaterial color={c.skin} roughness={0.8} flatShading />;
  const outfitMat = <meshStandardMaterial color={c.outfit} roughness={0.75} flatShading />;
  const legMat = <meshStandardMaterial color={look.inactive ? "#2f3441" : "#1a1f2b"} roughness={0.9} />;
  // Un agente inactivo no se anima: todo él se fusiona con el mobiliario estático.
  // En los activos solo es dinámico lo que se mueve (torso, cabeza, brazos y aro).
  const dyn = { dynamic: !look.inactive };
  const bakeKey = `${avatar.hairStyle}-${avatar.accessory}-${look.inactive}`;

  return (
    <group>
      {/* Piernas sentadas */}
      {[-0.11, 0.11].map((x) => (
        <group key={x}>
          <mesh position={[x, 0.47, -0.16]}><boxGeometry args={[0.13, 0.12, 0.38]} />{legMat}</mesh>
          <mesh position={[x, 0.25, -0.33]}><boxGeometry args={[0.12, 0.42, 0.12]} />{legMat}</mesh>
          <mesh position={[x, 0.04, -0.37]}><boxGeometry args={[0.13, 0.07, 0.2]} /><meshStandardMaterial color="#0b0d12" /></mesh>
        </group>
      ))}
      <group ref={torso} position={[0, 0.62, 0]} userData={dyn}>
        {/* Torso con detalle de color de acento */}
        <mesh position={[0, 0.2, 0]}><capsuleGeometry args={[0.17, 0.26, 4, 10]} />{outfitMat}</mesh>
        <mesh position={[0, 0.3, -0.16]}><boxGeometry args={[0.08, 0.16, 0.02]} /><meshStandardMaterial color={c.accent} /></mesh>
        {/* Brazos hacia el teclado */}
        {[-1, 1].map((s) => (
          <group key={s} ref={s < 0 ? armL : armR} position={[0.22 * s, 0.36, -0.02]} rotation-x={-1.15}>
            <mesh position={[0, -0.15, 0]}><capsuleGeometry args={[0.05, 0.2, 3, 8]} />{outfitMat}</mesh>
            <mesh position={[0, -0.31, 0]}><sphereGeometry args={[0.05, 8, 6]} />{skinMat}</mesh>
          </group>
        ))}
        <group ref={head} position={[0, 0.66, 0]}>
          <Baked version={bakeKey}>
          <mesh position={[0, -0.12, 0]}><cylinderGeometry args={[0.06, 0.07, 0.1, 8]} />{skinMat}</mesh>
          <mesh><sphereGeometry args={[0.19, 16, 14]} />{skinMat}</mesh>
          <Hair style={avatar.hairStyle} color={c.hair} />
          {/* Ojos (miran hacia -z, al monitor) */}
          {!look.inactive && [-0.065, 0.065].map((x) => (
            <mesh key={x} position={[x, 0.01, -0.175]}><sphereGeometry args={[0.022, 8, 6]} /><meshStandardMaterial color="#0b0d12" /></mesh>
          ))}
          {avatar.accessory === "glasses" && (
            <group position={[0, 0.01, -0.185]}>
              {[-0.065, 0.065].map((x) => (
                <mesh key={x} position={[x, 0, 0]}><torusGeometry args={[0.045, 0.01, 6, 14]} /><meshStandardMaterial color="#0b0d12" /></mesh>
              ))}
            </group>
          )}
          {avatar.accessory === "headset" && (
            <group>
              <mesh rotation-z={Math.PI / 2}><torusGeometry args={[0.215, 0.018, 6, 18, Math.PI]} /><meshStandardMaterial color={look.inactive ? OFF.accent : avatar.accent} /></mesh>
              <mesh position={[-0.2, -0.02, 0]}><cylinderGeometry args={[0.05, 0.05, 0.05, 10]} /><meshStandardMaterial color="#0b0d12" /></mesh>
            </group>
          )}
          {avatar.accessory === "earring" && !look.inactive && (
            <mesh position={[0.19, -0.06, 0]}><sphereGeometry args={[0.018, 8, 6]} /><meshStandardMaterial color="#f5b800" metalness={0.6} roughness={0.3} /></mesh>
          )}
          </Baked>
          {/* Pensando: tres puntos sobre la cabeza */}
          <group ref={dots} position={[0, 0.36, 0]} visible={false} userData={{ dynamic: true }}>
            {[-0.07, 0, 0.07].map((x) => (
              <mesh key={x} position={[x, 0, 0]}><sphereGeometry args={[0.025, 8, 6]} /><meshStandardMaterial color="#f5b800" emissive="#f5b800" emissiveIntensity={0.8} /></mesh>
            ))}
          </group>
        </group>
      </group>
      {/* Aro de estado bajo la silla */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.015} userData={dyn}>
        <ringGeometry args={[0.55, 0.62, 40]} />
        <meshStandardMaterial ref={halo} color={look.ring} emissive={look.ring} emissiveIntensity={0.6} transparent opacity={look.inactive ? 0.35 : 0.95} />
      </mesh>
    </group>
  );
}

/** Marca flotante del estado (solo estados que lo merecen; fija salvo «esperando aprobación»). */
export function StatusMark({ look, reducedMotion }: { look: SceneLook; reducedMotion: boolean }) {
  const ref = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current && look.pose === "alert" && look.animated && !reducedMotion) {
      ref.current.position.y = 2.05 + Math.sin(clock.getElapsedTime() * 2.5) * 0.04;
    }
  });
  if (look.inactive) return null;
  if (look.pose === "done") {
    return (
      <mesh position={[0, 2.05, 0]}>
        <torusGeometry args={[0.1, 0.025, 6, 20]} />
        <meshStandardMaterial color="#12b76a" emissive="#12b76a" emissiveIntensity={0.7} />
      </mesh>
    );
  }
  if (look.pose === "alert") {
    return (
      <mesh ref={ref} position={[0, 2.05, 0]} rotation-z={Math.PI / 4}>
        <boxGeometry args={[0.16, 0.16, 0.04]} />
        <meshStandardMaterial color={look.ring} emissive={look.ring} emissiveIntensity={0.9} />
      </mesh>
    );
  }
  if (look.pose === "waiting") {
    return (
      <group position={[0, 2.05, 0]}>
        {[0.06, -0.06].map((y) => (
          <mesh key={y} position={[0, y, 0]} rotation-x={y > 0 ? Math.PI : 0}>
            <coneGeometry args={[0.07, 0.11, 10]} />
            <meshStandardMaterial color="#8a91a6" emissive="#8a91a6" emissiveIntensity={0.3} />
          </mesh>
        ))}
      </group>
    );
  }
  return null;
}
