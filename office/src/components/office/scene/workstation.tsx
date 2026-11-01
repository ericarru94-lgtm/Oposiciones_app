"use client";

// Puesto de trabajo: zona del departamento, mesa, silla, monitor con la
// pantalla de su función, mobiliario propio y el personaje. La pantalla solo
// se enciende si el agente está en el piloto, y solo «trabaja» con estados
// reales en curso.

import { Html } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { useMemo, type ReactNode, type RefObject } from "react";
import { Color } from "three";
import { DEPARTMENTS } from "@/lib/agents/catalog";
import { AGENT_STATUS_LABEL } from "@/lib/domain/status";
import type { Station, StationProp } from "@/lib/office/layout";
import type { OfficeAgent } from "../types";
import { Character, StatusMark } from "./character";
import { idleScreenTexture, screenTexture } from "./textures";

const WOOD = "#8a6a4f";
const WOOD_DARK = "#5e4634";
const METAL = "#2a3142";
const FABRIC = "#2c3447";
/** Tono medio del suelo de madera, para mezclar el color de cada zona. */
const FLOOR = "#363c4b";

function Box({ p, s, c, r = 0, e, ei = 0.6 }: { p: [number, number, number]; s: [number, number, number]; c: string; r?: number; e?: string; ei?: number }) {
  return (
    <mesh position={p} rotation-y={r}>
      <boxGeometry args={s} />
      <meshStandardMaterial color={c} roughness={0.7} emissive={e ?? "#000000"} emissiveIntensity={e ? ei : 0} />
    </mesh>
  );
}

function Plant({ p, s = 1 }: { p: [number, number, number]; s?: number }) {
  return (
    <group position={p} scale={s}>
      <mesh position={[0, 0.22, 0]}><cylinderGeometry args={[0.2, 0.16, 0.44, 12]} /><meshStandardMaterial color="#d9d4c7" roughness={0.9} /></mesh>
      <mesh position={[0, 0.68, 0]}><icosahedronGeometry args={[0.36, 0]} /><meshStandardMaterial color="#2f7a4f" flatShading roughness={0.8} /></mesh>
      <mesh position={[0.12, 0.92, 0.05]}><icosahedronGeometry args={[0.22, 0]} /><meshStandardMaterial color="#3d9461" flatShading roughness={0.8} /></mesh>
    </group>
  );
}

function Board({ p, r = 0, w = 1.4, h = 0.9, children }: { p: [number, number, number]; r?: number; w?: number; h?: number; children?: ReactNode }) {
  return (
    <group position={p} rotation-y={r}>
      <Box p={[0, 0, 0]} s={[w, h, 0.05]} c="#e9ecf2" />
      <Box p={[0, -h / 2 - 0.02, 0.02]} s={[w, 0.04, 0.08]} c={METAL} />
      <group position={[0, 0, 0.03]}>{children}</group>
    </group>
  );
}

/** Mobiliario por función. Coordenadas locales del puesto (el personaje mira hacia -z). */
function Prop({ kind, lit, accent }: { kind: StationProp; lit: boolean; accent: string }) {
  const glow = lit ? accent : undefined;
  switch (kind) {
    case "plant":
      return <Plant p={[1.55, 0, 0.9]} s={0.9} />;
    case "bookshelf":
      return (
        <group position={[-1.75, 0, -0.2]} rotation-y={Math.PI / 2}>
          <Box p={[0, 0.8, 0]} s={[1.3, 1.6, 0.36]} c={WOOD_DARK} />
          {[0.35, 0.8, 1.25].map((y) => (
            <group key={y}>
              {[-0.45, -0.3, -0.18, 0.05, 0.2, 0.42].map((x, i) => (
                <Box key={x} p={[x, y + 0.12, 0.05]} s={[0.1, 0.28 + (i % 3) * 0.04, 0.24]} c={["#2747f5", "#ff4b2b", "#e8ecf8", "#8b5cf6", "#12b76a", "#f5b800"][i]} />
              ))}
            </group>
          ))}
        </group>
      );
    case "dualMonitor":
      return (
        <group position={[0.62, 0.79, -0.33]} rotation-y={-0.35}>
          <Box p={[0, 0.3, 0]} s={[0.62, 0.38, 0.04]} c="#0b0d12" />
          <Box p={[0, 0.3, 0.025]} s={[0.56, 0.32, 0.005]} c={lit ? "#ff4b2b" : "#05060a"} e={glow ? "#ff4b2b" : undefined} ei={0.35} />
          <Box p={[0, 0.06, 0]} s={[0.05, 0.12, 0.05]} c={METAL} />
        </group>
      );
    case "tripleMonitor":
      return (
        <group>
          {[-0.62, 0.62].map((x) => (
            <group key={x} position={[x, 0.79, -0.3]} rotation-y={x < 0 ? 0.4 : -0.4}>
              <Box p={[0, 0.3, 0]} s={[0.56, 0.36, 0.04]} c="#0b0d12" />
              <Box p={[0, 0.3, 0.025]} s={[0.5, 0.3, 0.005]} c={lit ? "#22d3ee" : "#05060a"} e={glow ? "#22d3ee" : undefined} ei={0.35} />
            </group>
          ))}
        </group>
      );
    case "phone":
      return <Box p={[-0.6, 0.81, 0.05]} s={[0.16, 0.05, 0.22]} c="#0b0d12" />;
    case "funnelBoard":
      return (
        <Board p={[-1.85, 1.2, 0.3]} r={Math.PI / 2}>
          {[0.6, 0.45, 0.3, 0.18].map((w, i) => <Box key={i} p={[0, 0.25 - i * 0.17, 0]} s={[w, 0.12, 0.01]} c={i === 3 ? "#ff4b2b" : "#5b7bff"} />)}
        </Board>
      );
    case "campaignBoard":
      return (
        <Board p={[-1.85, 1.2, 0.2]} r={Math.PI / 2} w={1.6}>
          {[-0.5, 0, 0.5].flatMap((x, c) => [0.22, 0.02, -0.18].slice(0, 3 - c).map((y) => (
            <Box key={`${x}${y}`} p={[x, y, 0]} s={[0.36, 0.14, 0.01]} c={["#f5b800", "#5b7bff", "#12b76a"][c]} />
          )))}
        </Board>
      );
    case "paperStack":
      return (
        <group position={[-0.62, 0.8, 0.05]}>
          {[0, 0.03, 0.06].map((y, i) => <Box key={y} p={[0, y, 0]} s={[0.3, 0.025, 0.4]} r={i * 0.08} c="#eef0f4" />)}
        </group>
      );
    case "deskLamp":
      return (
        <group position={[0.72, 0.78, -0.25]}>
          <mesh position={[0, 0.02, 0]}><cylinderGeometry args={[0.09, 0.1, 0.03, 12]} /><meshStandardMaterial color={METAL} /></mesh>
          <mesh position={[0, 0.25, 0]} rotation-z={0.25}><cylinderGeometry args={[0.012, 0.012, 0.46, 6]} /><meshStandardMaterial color={METAL} /></mesh>
          <mesh position={[-0.08, 0.47, 0]} rotation-z={-0.9}><coneGeometry args={[0.09, 0.14, 12, 1, true]} /><meshStandardMaterial color="#e8ecf8" emissive={lit ? "#ffd9a0" : "#000"} emissiveIntensity={lit ? 0.8 : 0} side={2} /></mesh>
        </group>
      );
    case "drawingTablet":
      return (
        <group position={[0.55, 0.795, 0.02]}>
          <Box p={[0, 0, 0]} s={[0.42, 0.02, 0.3]} c="#0b0d12" />
          <Box p={[0, 0.012, 0]} s={[0.34, 0.005, 0.22]} c={lit ? "#ec4899" : "#1a1f2b"} e={glow ? "#ec4899" : undefined} ei={0.3} />
        </group>
      );
    case "moodBoard":
      return (
        <Board p={[-1.75, 1.2, -0.6]} r={Math.PI / 2.4} w={1.2}>
          {["#ff4b2b", "#2747f5", "#ec4899", "#f5b800", "#0f172a", "#e8ecf8"].map((c, i) => (
            <Box key={c} p={[-0.38 + (i % 3) * 0.38, 0.17 - Math.floor(i / 3) * 0.34, 0]} s={[0.3, 0.26, 0.01]} c={c} />
          ))}
        </Board>
      );
    case "serverRack":
      return (
        <group position={[1.75, 0, -0.6]}>
          <Box p={[0, 0.85, 0]} s={[0.6, 1.7, 0.6]} c="#141824" />
          {[0.3, 0.55, 0.8, 1.05, 1.3, 1.55].map((y) => (
            <group key={y}>
              <Box p={[0, y, 0.305]} s={[0.5, 0.16, 0.01]} c="#1e2433" />
              {/* Indicadores encendidos solo si el agente está en el piloto. */}
              <Box p={[0.18, y, 0.312]} s={[0.04, 0.04, 0.005]} c={lit ? "#12b76a" : "#2a3142"} e={lit ? "#12b76a" : undefined} ei={0.8} />
            </group>
          ))}
        </group>
      );
    case "headsetStand":
      return (
        <group position={[0.6, 0.8, 0.05]}>
          <Box p={[0, 0.1, 0]} s={[0.04, 0.2, 0.04]} c={METAL} />
          <mesh position={[0, 0.22, 0]} rotation-x={Math.PI / 2}><torusGeometry args={[0.08, 0.015, 6, 14, Math.PI]} /><meshStandardMaterial color={accent} /></mesh>
        </group>
      );
    case "filingCabinet":
      return (
        <group position={[-1.6, 0, 0.1]}>
          <Box p={[0, 0.55, 0]} s={[0.5, 1.1, 0.6]} c="#3a4152" />
          {[0.3, 0.62, 0.94].map((y) => <Box key={y} p={[0, y, 0.305]} s={[0.2, 0.03, 0.01]} c="#9aa3b8" />)}
        </group>
      );
    case "chartBoard":
      return (
        <Board p={[1.75, 1.25, -0.4]} r={-Math.PI / 2.4} w={1.3}>
          {[0.15, 0.3, 0.22, 0.42, 0.36, 0.55].map((h, i) => <Box key={i} p={[-0.45 + i * 0.18, -0.3 + h / 2, 0]} s={[0.12, h, 0.01]} c={i === 5 ? "#12b76a" : "#5b7bff"} />)}
        </Board>
      );
    case "checklistBoard":
      return (
        <Board p={[1.75, 1.25, -0.4]} r={-Math.PI / 2.4} w={1.1}>
          {[0.25, 0.08, -0.09, -0.26].map((y, i) => (
            <group key={y}>
              <Box p={[-0.38, y, 0]} s={[0.1, 0.1, 0.01]} c={i < 3 ? "#12b76a" : "#c3c9d6"} />
              <Box p={[0.05, y, 0]} s={[0.6, 0.04, 0.01]} c="#9aa3b8" />
            </group>
          ))}
        </Board>
      );
    case "glassOffice":
    case "wallScreen":
      return null; // se dibujan a escala de zona (ver Zone)
  }
}

function GlassOffice({ station, lit, accent }: { station: Station; lit: boolean; accent: string }) {
  const { w, d } = station.zone;
  const glass = <meshPhysicalMaterial color="#9fb4ff" transparent opacity={0.12} roughness={0.05} metalness={0} />;
  const frame = <meshStandardMaterial color="#c8cfdc" metalness={0.4} roughness={0.4} />;
  return (
    <group>
      {/* Paredes de vidrio laterales y frontal con hueco de puerta */}
      {[-w / 2, w / 2].map((x) => (
        <group key={x} position={[x, 1.1, 0]}>
          <mesh><boxGeometry args={[0.04, 2.2, d]} />{glass}</mesh>
          <mesh position={[0, 1.1, 0]}><boxGeometry args={[0.07, 0.05, d]} />{frame}</mesh>
        </group>
      ))}
      {[[-w / 4 - 0.4, w / 2 - 0.8], [w / 4 + 0.4, w / 2 - 0.8]].map(([x, ww]) => (
        <group key={x} position={[x, 1.1, d / 2]}>
          <mesh><boxGeometry args={[ww, 2.2, 0.04]} />{glass}</mesh>
          <mesh position={[0, 1.1, 0]}><boxGeometry args={[ww, 0.05, 0.07]} />{frame}</mesh>
        </group>
      ))}
      {/* Pantalla de pared con el plan de la misión */}
      <group position={[0, 1.55, -d / 2 + 0.08]}>
        <Box p={[0, 0, 0]} s={[2.2, 1.25, 0.06]} c="#0b0d12" />
        <mesh position={[0, 0, 0.035]}>
          <planeGeometry args={[2.05, 1.12]} />
          <meshStandardMaterial map={lit ? screenTexture("org") : undefined} color={lit ? "#ffffff" : "#05060a"} emissive={lit ? "#ffffff" : "#000"} emissiveMap={lit ? screenTexture("org") : undefined} emissiveIntensity={lit ? 0.55 : 0} toneMapped={false} />
        </mesh>
        <Box p={[0.95, -0.55, 0.04]} s={[0.06, 0.06, 0.01]} c={accent} e={accent} />
      </group>
      {/* Sofá de visitas */}
      <group position={[-w / 2 + 0.9, 0, d / 2 - 0.9]} rotation-y={Math.PI / 2}>
        <Box p={[0, 0.25, 0]} s={[1.2, 0.3, 0.6]} c="#2b3245" />
        <Box p={[0, 0.5, -0.25]} s={[1.2, 0.45, 0.12]} c="#2b3245" />
      </group>
    </group>
  );
}

function Screen({ station, look }: { station: Station; look: OfficeAgent["look"] }) {
  const tex = useMemo(() => {
    if (look.screen === "off") return null;
    return look.screen === "idle" ? idleScreenTexture() : screenTexture(station.screen);
  }, [look.screen, station.screen]);
  const tint = look.screen === "warning" ? "#ff8a70" : look.screen === "error" ? "#ff5a4f" : "#ffffff";
  return (
    <mesh position={[0, 0.3, 0.025]} userData={{ dynamic: true }}>
      <planeGeometry args={[0.74, 0.44]} />
      {tex ? (
        <meshStandardMaterial map={tex} emissiveMap={tex} color={tint} emissive={tint} emissiveIntensity={look.screen === "idle" ? 0.35 : 0.75} toneMapped={false} />
      ) : (
        <meshStandardMaterial color="#05060a" roughness={0.3} />
      )}
    </mesh>
  );
}

export function Workstation({
  agent, station, selected, onSelect, reducedMotion, labels, compact,
}: {
  agent: OfficeAgent;
  station: Station;
  selected: boolean;
  onSelect: (id: string) => void;
  reducedMotion: boolean;
  labels: RefObject<HTMLDivElement | null>;
  compact: boolean;
}) {
  const dept = DEPARTMENTS[agent.department];
  const { look } = agent;
  const lit = !look.inactive;
  const desk = station.wide ? { w: 2.2, d: 1.0 } : { w: 1.7, d: 0.85 };
  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onSelect(agent.id);
  };
  const statusText = look.inactive ? "Inactivo" : AGENT_STATUS_LABEL[agent.status];
  const zoneColor = useMemo(() => `#${new Color(FLOOR).lerp(new Color(dept.color), lit ? 0.2 : 0.09).getHexString()}`, [dept.color, lit]);
  const edgeColor = useMemo(() => `#${new Color("#0b0f19").lerp(new Color(dept.color), lit ? 0.6 : 0.25).getHexString()}`, [dept.color, lit]);

  return (
    <group position={[station.x, 0, station.z]}>
      {/* Alfombra de la zona con el color del departamento */}
      <group position={[station.zone.dx ?? 0, 0, station.zone.dz ?? 0]}>
        {/* Opaca, con el color del departamento ya mezclado con el suelo (más barata que una transparencia). */}
        <mesh rotation-x={-Math.PI / 2} position-y={0.004} receiveShadow>
          <planeGeometry args={[station.zone.w, station.zone.d]} />
          <meshStandardMaterial color={zoneColor} roughness={1} />
        </mesh>
        {/* Borde fino de la zona */}
        {[[0, -station.zone.d / 2, station.zone.w, 0.03], [0, station.zone.d / 2, station.zone.w, 0.03], [-station.zone.w / 2, 0, 0.03, station.zone.d], [station.zone.w / 2, 0, 0.03, station.zone.d]].map(([x, z, w, d], i) => (
          <mesh key={i} rotation-x={-Math.PI / 2} position={[x, 0.007, z]}>
            <planeGeometry args={[w, d]} />
            <meshBasicMaterial color={edgeColor} />
          </mesh>
        ))}
      </group>

      {station.props.includes("glassOffice") && <GlassOffice station={station} lit={lit} accent={dept.color} />}

      <group rotation-y={station.rotation}>
        {/* Zona de clic: una caja invisible por puesto. Así el puntero solo se
            comprueba contra 9 cajas y no contra cientos de piezas de mobiliario. */}
        <mesh
          position={[0, 0.9, 0.05]}
          visible={false}
          userData={{ dynamic: true }}
          onClick={click}
          onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = "pointer"; }}
          onPointerOut={() => (document.body.style.cursor = "")}
        >
          <boxGeometry args={[desk.w + 0.5, 1.9, 2.1]} />
          <meshBasicMaterial />
        </mesh>
        {/* Mesa: tablero de madera y patas metálicas */}
        <mesh position={[0, 0.76, -0.2]} castShadow>
          <boxGeometry args={[desk.w, 0.05, desk.d]} />
          <meshStandardMaterial color={lit ? WOOD : "#4a4038"} roughness={0.55} />
        </mesh>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * (desk.w / 2 - 0.08), 0.37, -0.2]}>
            <boxGeometry args={[0.05, 0.74, desk.d - 0.1]} />
            <meshStandardMaterial color={METAL} metalness={0.5} roughness={0.4} />
          </mesh>
        ))}
        <Box p={[0, 0.5, -0.2 - desk.d / 2 + 0.03]} s={[desk.w - 0.2, 0.42, 0.02]} c={METAL} />
        {/* Monitor principal con la pantalla de su función */}
        <group position={[0, 0.79, -0.42]}>
          <Box p={[0, 0.3, 0]} s={[0.8, 0.5, 0.04]} c="#0b0d12" />
          <Screen station={station} look={look} />
          <Box p={[0, 0.06, 0]} s={[0.06, 0.12, 0.06]} c={METAL} />
          <Box p={[0, 0.01, 0]} s={[0.26, 0.015, 0.16]} c={METAL} />
          {/* Punto naranja de la marca en el dorso del monitor */}
          <Box p={[0, 0.3, -0.022]} s={[0.05, 0.05, 0.004]} c="#ff4b2b" e={lit ? "#ff4b2b" : undefined} />
        </group>
        {/* Teclado y ratón */}
        <Box p={[0, 0.795, -0.08]} s={[0.46, 0.02, 0.15]} c="#1a1f2b" />
        <Box p={[0.34, 0.795, -0.06]} s={[0.07, 0.02, 0.1]} c="#1a1f2b" />
        {/* Taza */}
        <mesh position={[-0.42, 0.83, -0.25]}><cylinderGeometry args={[0.04, 0.035, 0.09, 10]} /><meshStandardMaterial color={dept.color} /></mesh>
        {/* Silla */}
        <group position={[0, 0, 0.42]}>
          <Box p={[0, 0.44, 0]} s={[0.56, 0.08, 0.52]} c={FABRIC} />
          <Box p={[0, 0.8, 0.27]} s={[0.54, 0.62, 0.07]} c={FABRIC} />
          <Box p={[0, 0.82, 0.31]} s={[0.4, 0.4, 0.02]} c={lit ? dept.color : "#2a3142"} />
          <mesh position={[0, 0.22, 0]}><cylinderGeometry args={[0.03, 0.03, 0.4, 8]} /><meshStandardMaterial color={METAL} /></mesh>
          {[0, 1, 2, 3, 4].map((i) => (
            <mesh key={i} position={[Math.sin((i / 5) * Math.PI * 2) * 0.22, 0.04, Math.cos((i / 5) * Math.PI * 2) * 0.22]} rotation-y={(i / 5) * Math.PI * 2}>
              <boxGeometry args={[0.04, 0.03, 0.26]} />
              <meshStandardMaterial color={METAL} />
            </mesh>
          ))}
          {/* El personaje marca como dinámico lo que se anima con el estado real. */}
          <Character avatar={agent.avatar} look={look} reducedMotion={reducedMotion} />
          <group userData={{ dynamic: true }}>
            <StatusMark look={look} reducedMotion={reducedMotion} />
          </group>
        </group>
        {station.props.map((p) => <Prop key={p} kind={p} lit={lit} accent={dept.color} />)}
        {/* Foco suave del puesto seleccionado */}
        {selected && (
          <mesh rotation-x={-Math.PI / 2} position={[0, 0.01, 0.1]} userData={{ dynamic: true }}>
            <circleGeometry args={[1.25, 40]} />
            <meshBasicMaterial color="#5b7bff" transparent opacity={0.14} />
          </mesh>
        )}
      </group>

      <Html position={[0, 2.35, 0]} center zIndexRange={[20, 0]} portal={labels as RefObject<HTMLElement>}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSelect(agent.id);
          }}
          aria-pressed={selected}
          aria-label={`${agent.name}, ${agent.role}: ${look.inactive ? "inactivo, fuera del piloto" : AGENT_STATUS_LABEL[agent.status]}`}
          className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 transition-colors ${
            selected ? "bg-cobalt text-white ring-cobalt-soft" : "bg-[#0b0f19]/90 text-paper ring-white/10 hover:ring-cobalt-soft"
          } ${look.inactive && !selected ? "opacity-70" : ""}`}
        >
          <span className="size-1.5 rounded-full" style={{ background: look.inactive ? "#667085" : look.ring }} />
          {agent.name}
          {!compact && <span className="font-normal text-paper/60">· {statusText}</span>}
        </button>
      </Html>
    </group>
  );
}
