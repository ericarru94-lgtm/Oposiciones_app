"use client";

// Oficina 3D. Solo dibuja: recibe el estado real de los agentes y no tiene
// acciones (no llama al servidor ni a herramientas). Se carga en diferido
// (next/dynamic, sin SSR) solo cuando la vista 3D está activa.

import { Html, OrbitControls, OrthographicCamera } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import type { Group, Mesh, MeshStandardMaterial } from "three";
import { DEPARTMENTS, type AvatarSpec } from "@/lib/agents/registry";
import { AGENT_STATUS_LABEL } from "@/lib/domain/status";
import { needsAnimation, sceneLook, type SceneLook } from "@/lib/office/scene";
import type { OfficeAgent } from "./types";

const INACTIVE = "#4A5062";

/** Mantiene el bucle de dibujo solo mientras hay algo en curso. */
function Animator({ active }: { active: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  useFrame(() => {
    if (active) invalidate();
  });
  return null;
}

function Floor() {
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position-y={-0.01} receiveShadow>
        <planeGeometry args={[22, 18]} />
        <meshStandardMaterial color="#171b27" />
      </mesh>
      <gridHelper args={[22, 22, "#262c3f", "#1e2333"]} position-y={0} />
      {/* Pared del fondo con el eslogan de la marca. */}
      <mesh position={[0, 1.6, -9]}>
        <boxGeometry args={[22, 3.2, 0.2]} />
        <meshStandardMaterial color="#1c2130" />
      </mesh>
      <Html position={[0, 2.6, -8.8]} center pointerEvents="none" zIndexRange={[1, 0]}>
        <p className="select-none whitespace-nowrap font-display text-xs font-semibold tracking-[0.3em] text-paper/70">
          HE SIGNAL · IA · CHATBOTS · MARKETING
        </p>
      </Html>
    </group>
  );
}

function Zone({ agent }: { agent: OfficeAgent }) {
  const color = DEPARTMENTS[agent.department].color;
  return (
    <mesh rotation-x={-Math.PI / 2} position={[agent.desk.x, 0.005, agent.desk.z]}>
      <planeGeometry args={[3.2, 3.2]} />
      <meshStandardMaterial color={color} transparent opacity={agent.look.inactive ? 0.05 : 0.14} />
    </mesh>
  );
}

const SCREEN_COLOR: Record<SceneLook["screen"], string> = {
  off: "#05060a",
  idle: "#1d2a6b",
  active: "#5B74FF",
  warning: "#FF4B2B",
  error: "#F04438",
};

function Desk({ look }: { look: SceneLook }) {
  const top = look.inactive ? "#2a2f3c" : "#3d465e";
  return (
    <group>
      <mesh position={[0, 0.75, 0]}>
        <boxGeometry args={[1.8, 0.08, 0.9]} />
        <meshStandardMaterial color={top} />
      </mesh>
      {[-0.8, 0.8].map((x) => (
        <mesh key={x} position={[x, 0.37, 0]}>
          <boxGeometry args={[0.06, 0.74, 0.8]} />
          <meshStandardMaterial color="#1a1e29" />
        </mesh>
      ))}
      {/* Monitor */}
      <mesh position={[0, 1.15, -0.3]}>
        <boxGeometry args={[0.9, 0.55, 0.05]} />
        <meshStandardMaterial color="#0b0d12" />
      </mesh>
      <mesh position={[0, 1.15, -0.27]}>
        <planeGeometry args={[0.82, 0.47]} />
        <meshStandardMaterial
          color={SCREEN_COLOR[look.screen]}
          emissive={SCREEN_COLOR[look.screen]}
          emissiveIntensity={look.screen === "off" ? 0 : 0.8}
        />
      </mesh>
      {/* Punto naranja de la marca en la placa */}
      <mesh position={[0.75, 0.8, 0.4]}>
        <sphereGeometry args={[0.04, 8, 8]} />
        <meshStandardMaterial color="#FF4B2B" emissive="#FF4B2B" emissiveIntensity={look.inactive ? 0 : 0.6} />
      </mesh>
      {/* Silla */}
      <mesh position={[0, 0.45, 0.85]}>
        <boxGeometry args={[0.55, 0.08, 0.55]} />
        <meshStandardMaterial color="#141721" />
      </mesh>
      <mesh position={[0, 0.8, 1.12]}>
        <boxGeometry args={[0.55, 0.6, 0.08]} />
        <meshStandardMaterial color="#141721" />
      </mesh>
    </group>
  );
}

function HairMesh({ style, color }: { style: AvatarSpec["hairStyle"]; color: string }) {
  const m = <meshStandardMaterial color={color} flatShading />;
  switch (style) {
    case "bun":
      return (
        <group>
          <mesh position={[0, 0.18, 0.02]} scale={[1, 0.6, 1]}><sphereGeometry args={[0.27, 10, 8]} />{m}</mesh>
          <mesh position={[0, 0.36, 0.12]}><sphereGeometry args={[0.11, 8, 6]} />{m}</mesh>
        </group>
      );
    case "long":
    case "wavy":
      return (
        <group>
          <mesh position={[0, 0.16, 0.03]} scale={[1.05, 0.65, 1.05]}><sphereGeometry args={[0.27, 10, 8]} />{m}</mesh>
          <mesh position={[0, -0.1, 0.16]}><boxGeometry args={[0.5, 0.42, 0.14]} />{m}</mesh>
        </group>
      );
    case "ponytail":
      return (
        <group>
          <mesh position={[0, 0.16, 0.02]} scale={[1, 0.62, 1]}><sphereGeometry args={[0.27, 10, 8]} />{m}</mesh>
          <mesh position={[0, 0, 0.3]} rotation-x={0.5}><coneGeometry args={[0.08, 0.35, 6]} />{m}</mesh>
        </group>
      );
    case "curly":
      return <mesh position={[0, 0.16, 0.02]} scale={[1.12, 0.75, 1.12]}><icosahedronGeometry args={[0.27, 0]} />{m}</mesh>;
    case "buzz":
      return <mesh position={[0, 0.12, 0.02]} scale={[0.98, 0.5, 0.98]}><sphereGeometry args={[0.26, 10, 8]} />{m}</mesh>;
    default:
      return <mesh position={[0, 0.15, 0.02]} scale={[1.02, 0.58, 1.02]}><sphereGeometry args={[0.27, 10, 8]} />{m}</mesh>;
  }
}

function Character({ agent, reducedMotion }: { agent: OfficeAgent; reducedMotion: boolean }) {
  const { look, avatar } = agent;
  const head = useRef<Group>(null);
  const armL = useRef<Mesh>(null);
  const armR = useRef<Mesh>(null);
  const ring = useRef<MeshStandardMaterial>(null);
  const skin = look.inactive ? "#5b606e" : avatar.skin;
  const outfit = look.inactive ? INACTIVE : avatar.outfit;
  const hair = look.inactive ? "#2b2f3a" : avatar.hair;

  // Animación = función del tiempo y del estado; nunca aleatoria.
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const on = look.animated && !reducedMotion;
    if (armL.current && armR.current) {
      const typing = on && look.pose === "typing";
      armL.current.rotation.x = -1.1 + (typing ? Math.sin(t * 12) * 0.12 : 0);
      armR.current.rotation.x = -1.1 + (typing ? Math.sin(t * 12 + Math.PI) * 0.12 : 0);
    }
    if (head.current) {
      head.current.rotation.z = on && look.pose === "thinking" ? Math.sin(t * 1.5) * 0.12 : 0;
      head.current.rotation.x = look.pose === "reading" ? 0.25 : look.pose === "off" ? 0.35 : 0;
    }
    if (ring.current) ring.current.emissiveIntensity = on ? 0.6 + Math.sin(t * 3) * 0.35 : look.inactive ? 0 : 0.5;
  });

  return (
    <group position={[0, 0, 0.85]} rotation-y={Math.PI}>
      {/* Cuerpo sentado */}
      <mesh position={[0, 0.82, 0]}>
        <capsuleGeometry args={[0.22, 0.38, 4, 8]} />
        <meshStandardMaterial color={outfit} flatShading />
      </mesh>
      {[-0.27, 0.27].map((x, i) => (
        <mesh key={x} ref={i === 0 ? armL : armR} position={[x, 0.95, -0.05]} rotation-x={-1.1}>
          <capsuleGeometry args={[0.06, 0.32, 3, 6]} />
          <meshStandardMaterial color={outfit} flatShading />
        </mesh>
      ))}
      <group ref={head} position={[0, 1.38, 0]}>
        <mesh>
          <icosahedronGeometry args={[0.26, 1]} />
          <meshStandardMaterial color={skin} flatShading />
        </mesh>
        <group rotation-y={Math.PI}>
          <HairMesh style={avatar.hairStyle} color={hair} />
        </group>
        {avatar.accessory === "glasses" && (
          <mesh position={[0, 0.02, -0.25]}>
            <boxGeometry args={[0.36, 0.07, 0.02]} />
            <meshStandardMaterial color="#0b0d12" />
          </mesh>
        )}
        {avatar.accessory === "headset" && (
          <mesh rotation-z={Math.PI / 2}>
            <torusGeometry args={[0.28, 0.025, 6, 16, Math.PI]} />
            <meshStandardMaterial color={look.inactive ? INACTIVE : avatar.accent} />
          </mesh>
        )}
      </group>
      {/* Aro de estado en el suelo */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.02}>
        <ringGeometry args={[0.5, 0.58, 32]} />
        <meshStandardMaterial ref={ring} color={look.ring} emissive={look.ring} emissiveIntensity={0.5} />
      </mesh>
    </group>
  );
}

function Workstation({
  agent, selected, onSelect, reducedMotion,
}: { agent: OfficeAgent; selected: boolean; onSelect: (id: string) => void; reducedMotion: boolean }) {
  return (
    <group position={[agent.desk.x, 0, agent.desk.z]} rotation-y={agent.desk.rotation}>
      <group
        onClick={(e) => {
          e.stopPropagation();
          onSelect(agent.id);
        }}
        onPointerOver={() => (document.body.style.cursor = "pointer")}
        onPointerOut={() => (document.body.style.cursor = "")}
      >
        <Desk look={agent.look} />
        <Character agent={agent} reducedMotion={reducedMotion} />
      </group>
      <Html position={[0, 2.15, 0.85]} center zIndexRange={[20, 0]}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSelect(agent.id);
          }}
          aria-pressed={selected}
          aria-label={`${agent.name}: ${agent.look.inactive ? "inactivo, fuera del piloto" : AGENT_STATUS_LABEL[agent.status]}`}
          className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-medium backdrop-blur transition ${
            selected ? "border-cobalt bg-cobalt text-white" : "border-line bg-ink/80 text-paper hover:border-cobalt"
          } ${agent.look.inactive ? "opacity-60" : ""}`}
        >
          <span className="mr-1.5 inline-block size-1.5 rounded-full align-middle" style={{ background: agent.look.ring }} />
          {agent.name}
          <span className="ml-1 text-muted">
            · {agent.look.inactive ? "Inactivo" : AGENT_STATUS_LABEL[agent.status]}
          </span>
        </button>
      </Html>
    </group>
  );
}

export default function Office3D({
  agents, selectedId, onSelect, reducedMotion,
}: {
  agents: Omit<OfficeAgent, "look">[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  reducedMotion: boolean;
}) {
  const withLook = useMemo(() => agents.map((a) => ({ ...a, look: sceneLook(a.id, a.status) })), [agents]);
  const animate = needsAnimation(agents, reducedMotion);
  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 1.5]}
      gl={{ antialias: true, powerPreference: "low-power" }}
      onPointerMissed={(e) => {
        // Solo un clic en el suelo vacío deselecciona (no las etiquetas HTML).
        if ((e.target as HTMLElement | null)?.tagName === "CANVAS") onSelect(null);
      }}
      aria-label="Oficina 3D de HE Signal"
      data-testid="office-3d"
    >
      <color attach="background" args={["#06070a"]} />
      <OrthographicCamera makeDefault position={[14, 14, 14]} zoom={46} near={-50} far={200} />
      <OrbitControls
        enableRotate
        minPolarAngle={Math.PI / 5}
        maxPolarAngle={Math.PI / 3}
        minZoom={20}
        maxZoom={90}
        enableDamping={false}
        target={[0, 0, 0]}
      />
      <ambientLight intensity={0.9} />
      <hemisphereLight args={["#dfe6ff", "#10131c", 0.6]} />
      <directionalLight position={[8, 14, 6]} intensity={1.5} />
      <Animator active={animate} />
      <Floor />
      {withLook.map((a) => (
        <Zone key={`z-${a.id}`} agent={a} />
      ))}
      {withLook.map((a) => (
        <Workstation key={a.id} agent={a} selected={a.id === selectedId} onSelect={onSelect} reducedMotion={reducedMotion} />
      ))}
    </Canvas>
  );
}
