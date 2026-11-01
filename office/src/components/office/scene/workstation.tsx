"use client";

// Puesto de trabajo: zona del departamento con tótem, mesa grande, silla
// ergonómica, monitores con la pantalla de su función, mobiliario propio y el
// trabajador. Las pantallas solo se encienden si el agente está en el piloto
// y solo «trabajan» con estados reales en curso.

import { Html } from "@react-three/drei";
import { RoundedBox } from "./rounded";
import type { ThreeEvent } from "@react-three/fiber";
import { Suspense, useMemo, type ReactNode, type RefObject } from "react";
import { Color } from "three";
import { DEPARTMENTS } from "@/lib/agents/catalog";
import { AGENT_STATUS_LABEL } from "@/lib/domain/status";
import type { ScreenKind, Station, StationProp } from "@/lib/office/layout";
import { staffModelOf } from "@/lib/office/staff-models";
import type { OfficeAgent } from "../types";
import { Character, StatusMark } from "./character";
import { StaffModel } from "./staff-model";
import { idleScreenTexture, screenTexture, signTexture } from "./textures";

const OAK = "#a07a55";
const OAK_DARK = "#6b4f38";
const METAL = "#2a3142";
const STEEL = "#9aa3b5";
const FABRIC = "#2c3447";
/** Tono medio del suelo, para mezclar el color de cada zona. */
const FLOOR = "#2b3140";

function Box({ p, s, c, r = 0, e, ei = 0.6, rough = 0.7, metal = 0 }: { p: [number, number, number]; s: [number, number, number]; c: string; r?: number; e?: string; ei?: number; rough?: number; metal?: number }) {
  return (
    <mesh position={p} rotation-y={r} castShadow receiveShadow>
      <boxGeometry args={s} />
      <meshStandardMaterial color={c} roughness={rough} metalness={metal} emissive={e ?? "#000000"} emissiveIntensity={e ? ei : 0} />
    </mesh>
  );
}

function Plant({ p, s = 1 }: { p: [number, number, number]; s?: number }) {
  return (
    <group position={p} scale={s}>
      <mesh position={[0, 0.3, 0]} castShadow><cylinderGeometry args={[0.26, 0.2, 0.6, 20]} /><meshStandardMaterial color="#e6e1d6" roughness={0.6} /></mesh>
      {[[0, 1.0, 0, 0.42], [0.2, 1.35, 0.1, 0.3], [-0.22, 1.25, -0.08, 0.3], [0.05, 1.6, -0.1, 0.22]].map(([x, y, z, r], i) => (
        <mesh key={i} position={[x, y, z]} castShadow><icosahedronGeometry args={[r, 1]} /><meshStandardMaterial color={["#2f7a4f", "#3d9461", "#27693f", "#4aa36e"][i]} roughness={0.75} /></mesh>
      ))}
      <mesh position={[0, 0.75, 0]}><cylinderGeometry args={[0.03, 0.04, 0.5, 6]} /><meshStandardMaterial color="#4a3a2a" /></mesh>
    </group>
  );
}

function Board({ p, r = 0, w = 2, h = 1.2, children }: { p: [number, number, number]; r?: number; w?: number; h?: number; children?: ReactNode }) {
  return (
    <group position={p} rotation-y={r}>
      <Box p={[0, 0, 0]} s={[w, h, 0.06]} c="#eef1f6" rough={0.4} />
      <Box p={[0, 0, -0.02]} s={[w + 0.08, h + 0.08, 0.04]} c={METAL} />
      <group position={[0, 0, 0.035]}>{children}</group>
    </group>
  );
}

function Monitor({ p, r = 0, w = 0.95, kind, look, lit }: { p: [number, number, number]; r?: number; w?: number; kind: ScreenKind; look: OfficeAgent["look"]; lit: boolean }) {
  const h = w * 0.58;
  return (
    <group position={p} rotation-y={r}>
      {/* Brazo articulado */}
      <mesh position={[0, -0.12, 0.12]}><cylinderGeometry args={[0.018, 0.018, 0.34, 8]} /><meshStandardMaterial color={STEEL} metalness={0.7} roughness={0.3} /></mesh>
      <RoundedBox args={[w + 0.04, h + 0.04, 0.035]} radius={0.012} smoothness={2} position={[0, 0.12, 0]} castShadow>
        <meshStandardMaterial color="#0b0d12" roughness={0.35} metalness={0.3} />
      </RoundedBox>
      <Screen kind={kind} look={look} lit={lit} w={w} h={h} />
      <mesh position={[0, 0.12, -0.02]}><planeGeometry args={[0.06, 0.06]} /><meshStandardMaterial color="#ff4b2b" emissive={lit ? "#ff4b2b" : "#000"} emissiveIntensity={0.6} side={2} /></mesh>
    </group>
  );
}

/** La pantalla responde al estado real: apagada (fuera del piloto), reposo, trabajando, aviso o error. */
function Screen({ kind, look, lit, w, h }: { kind: ScreenKind; look: OfficeAgent["look"]; lit: boolean; w: number; h: number }) {
  const tex = useMemo(() => {
    if (!lit || look.screen === "off") return null;
    return look.screen === "idle" ? idleScreenTexture() : screenTexture(kind);
  }, [lit, look.screen, kind]);
  const tint = look.screen === "warning" ? "#ff8a70" : look.screen === "error" ? "#ff5a4f" : "#ffffff";
  return (
    <mesh position={[0, 0.12, 0.019]} userData={{ dynamic: true }}>
      <planeGeometry args={[w, h]} />
      {tex ? (
        <meshStandardMaterial map={tex} emissiveMap={tex} color={tint} emissive={tint} emissiveIntensity={look.screen === "idle" ? 0.4 : 0.85} toneMapped={false} />
      ) : (
        <meshStandardMaterial color="#04050a" roughness={0.15} metalness={0.4} />
      )}
    </mesh>
  );
}

/** Mobiliario por función, en coordenadas locales del puesto (el trabajador mira hacia -z). */
function Prop({ kind, lit, accent, look }: { kind: StationProp; lit: boolean; accent: string; look: OfficeAgent["look"] }) {
  switch (kind) {
    case "plant":
      return <Plant p={[2.4, 0, 1.2]} s={1} />;
    case "laptop":
      return (
        <group position={[-0.85, 0.79, 0.05]} rotation-y={0.35}>
          <Box p={[0, 0.01, 0]} s={[0.42, 0.02, 0.3]} c="#b8bfcc" metal={0.6} rough={0.35} />
          <group position={[0, 0.02, -0.15]} rotation-x={-1.85}>
            <Box p={[0, 0.15, 0]} s={[0.42, 0.3, 0.015]} c="#b8bfcc" metal={0.6} rough={0.35} />
          </group>
        </group>
      );
    case "bookshelf":
      return (
        <group position={[2.6, 0, 0.2]} rotation-y={-Math.PI / 2}>
          <Box p={[0, 1.1, 0]} s={[1.8, 2.2, 0.42]} c={OAK_DARK} rough={0.6} />
          {[0.35, 0.95, 1.55].map((y) => (
            <group key={y}>
              <Box p={[0, y - 0.05, 0.05]} s={[1.7, 0.04, 0.38]} c={OAK} />
              {[-0.7, -0.55, -0.42, -0.2, -0.05, 0.12, 0.4, 0.55].map((x, i) => (
                <Box key={x} p={[x, y + 0.14, 0.06]} s={[0.1, 0.3 + (i % 3) * 0.05, 0.26]} c={["#2747f5", "#ff4b2b", "#e8ecf8", "#8b5cf6", "#12b76a", "#f5b800", "#0f172a", "#ec4899"][i]} />
              ))}
            </group>
          ))}
        </group>
      );
    case "phone":
      return <Box p={[0.95, 0.8, 0.15]} s={[0.2, 0.06, 0.26]} c="#0b0d12" rough={0.3} />;
    case "funnelBoard":
      return (
        <Board p={[2.7, 1.5, 0.4]} r={-Math.PI / 2.4} w={2.2}>
          {[0.9, 0.7, 0.5, 0.3].map((w, i) => <Box key={i} p={[0, 0.36 - i * 0.24, 0]} s={[w, 0.16, 0.01]} c={i === 3 ? "#ff4b2b" : "#5b7bff"} />)}
        </Board>
      );
    case "campaignBoard":
      return (
        <Board p={[2.7, 1.5, 0.4]} r={-Math.PI / 2.4} w={2.4}>
          {[-0.75, 0, 0.75].flatMap((x, c) => [0.32, 0.04, -0.24].slice(0, 3 - c).map((y) => (
            <Box key={`${x}${y}`} p={[x, y, 0]} s={[0.55, 0.2, 0.01]} c={["#f5b800", "#5b7bff", "#12b76a"][c]} />
          )))}
        </Board>
      );
    case "paperStack":
      return (
        <group position={[-0.9, 0.79, 0.1]}>
          {[0, 0.03, 0.06, 0.09].map((y, i) => <Box key={y} p={[0, y, 0]} s={[0.32, 0.025, 0.42]} r={i * 0.07} c="#f3f4f6" />)}
        </group>
      );
    case "deskLamp":
      return (
        <group position={[1.05, 0.78, -0.35]}>
          <mesh position={[0, 0.02, 0]}><cylinderGeometry args={[0.11, 0.12, 0.03, 16]} /><meshStandardMaterial color={METAL} /></mesh>
          <mesh position={[0, 0.3, 0]} rotation-z={0.25}><cylinderGeometry args={[0.014, 0.014, 0.56, 8]} /><meshStandardMaterial color={METAL} /></mesh>
          <mesh position={[-0.1, 0.57, 0]} rotation-z={-0.9}><coneGeometry args={[0.11, 0.17, 16, 1, true]} /><meshStandardMaterial color="#e8ecf8" emissive={lit ? "#ffd9a0" : "#000"} emissiveIntensity={lit ? 0.8 : 0} side={2} /></mesh>
        </group>
      );
    case "drawingTablet":
      return (
        <group position={[0.85, 0.785, 0.05]}>
          <Box p={[0, 0, 0]} s={[0.5, 0.02, 0.36]} c="#0b0d12" rough={0.3} />
          <Box p={[0, 0.012, 0]} s={[0.42, 0.005, 0.28]} c={lit ? "#ec4899" : "#1a1f2b"} e={lit ? "#ec4899" : undefined} ei={0.3} />
        </group>
      );
    case "moodBoard":
      return (
        <Board p={[2.6, 1.5, -0.4]} r={-Math.PI / 2.4} w={1.8} h={1.3}>
          {["#ff4b2b", "#2747f5", "#ec4899", "#f5b800", "#0f172a", "#e8ecf8"].map((c, i) => (
            <Box key={c} p={[-0.56 + (i % 3) * 0.56, 0.27 - Math.floor(i / 3) * 0.54, 0]} s={[0.46, 0.42, 0.01]} c={c} />
          ))}
        </Board>
      );
    case "serverRack":
      return (
        <group>
          {[2.4, 3.1].map((x) => (
            <group key={x} position={[x, 0, -0.9]}>
              <Box p={[0, 1.05, 0]} s={[0.66, 2.1, 0.8]} c="#11151f" rough={0.4} metal={0.4} />
              {[0.35, 0.6, 0.85, 1.1, 1.35, 1.6, 1.85].map((y) => (
                <group key={y}>
                  <Box p={[0, y, 0.405]} s={[0.56, 0.18, 0.01]} c="#1c2232" />
                  {/* Indicadores encendidos solo si el agente está en el piloto. */}
                  <Box p={[0.2, y, 0.412]} s={[0.04, 0.04, 0.005]} c={lit ? "#12b76a" : "#2a3142"} e={lit ? "#12b76a" : undefined} ei={0.8} />
                </group>
              ))}
            </group>
          ))}
        </group>
      );
    case "headsetStand":
      return (
        <group position={[0.95, 0.79, 0.12]}>
          <Box p={[0, 0.12, 0]} s={[0.04, 0.24, 0.04]} c={METAL} />
          <mesh position={[0, 0.26, 0]} rotation-x={Math.PI / 2}><torusGeometry args={[0.09, 0.016, 8, 16, Math.PI]} /><meshStandardMaterial color={accent} /></mesh>
        </group>
      );
    case "filingCabinet":
      return (
        <group position={[-2.3, 0, 0.1]}>
          <Box p={[0, 0.65, 0]} s={[0.6, 1.3, 0.7]} c="#4a5264" rough={0.4} metal={0.3} />
          {[0.35, 0.75, 1.15].map((y) => <Box key={y} p={[0, y, 0.355]} s={[0.24, 0.03, 0.01]} c="#c3c9d6" metal={0.6} />)}
        </group>
      );
    case "chartBoard":
      return (
        <Board p={[2.6, 1.55, -0.5]} r={-Math.PI / 2.4} w={1.9} h={1.3}>
          {[0.2, 0.42, 0.32, 0.6, 0.5, 0.8].map((h, i) => <Box key={i} p={[-0.7 + i * 0.28, -0.45 + h / 2, 0]} s={[0.18, h, 0.01]} c={i === 5 ? "#12b76a" : "#5b7bff"} />)}
        </Board>
      );
    case "checklistBoard":
      return (
        <Board p={[2.6, 1.55, -0.5]} r={-Math.PI / 2.4} w={1.6} h={1.3}>
          {[0.38, 0.13, -0.12, -0.37].map((y, i) => (
            <group key={y}>
              <Box p={[-0.58, y, 0]} s={[0.14, 0.14, 0.01]} c={i < 3 ? "#12b76a" : "#c3c9d6"} />
              <Box p={[0.08, y, 0]} s={[0.95, 0.05, 0.01]} c="#9aa3b8" />
            </group>
          ))}
        </Board>
      );
    case "kpiTotem":
      return (
        <group position={[-2.6, 0, 1.2]} rotation-y={Math.PI}>
          <Box p={[0, 0.9, 0]} s={[0.7, 1.8, 0.12]} c="#0b0d12" rough={0.3} />
          <mesh position={[0, 1.05, 0.065]}><planeGeometry args={[0.6, 1.2]} />
            {lit ? <meshStandardMaterial map={screenTexture("crm")} emissiveMap={screenTexture("crm")} emissive="#ffffff" emissiveIntensity={look.screen === "off" ? 0 : 0.5} toneMapped={false} /> : <meshStandardMaterial color="#04050a" />}
          </mesh>
        </group>
      );
    case "glassOffice":
    case "videoWall":
      return null; // a escala de zona (ver GlassOffice)
  }
}

function GlassOffice({ station, lit, accent }: { station: Station; lit: boolean; accent: string }) {
  const { w, d } = station.zone;
  const glass = <meshPhysicalMaterial color="#b9c8ff" transparent opacity={0.16} roughness={0.04} metalness={0.1} envMapIntensity={1.4} />;
  const frame = <meshStandardMaterial color="#d6dbe6" metalness={0.7} roughness={0.25} />;
  const H = 2.8;
  return (
    <group>
      {/* Tarima de madera del despacho */}
      <mesh position={[0, 0.02, 0]} receiveShadow><boxGeometry args={[w, 0.04, d]} /><meshStandardMaterial color="#5a4433" roughness={0.45} /></mesh>
      {[-w / 2, w / 2].map((x) => (
        <group key={x} position={[x, H / 2, 0]}>
          <mesh><boxGeometry args={[0.05, H, d]} />{glass}</mesh>
          <mesh position={[0, H / 2, 0]}><boxGeometry args={[0.09, 0.06, d]} />{frame}</mesh>
          {[-d / 2, 0, d / 2].map((z) => <mesh key={z} position={[0, 0, z]}><boxGeometry args={[0.07, H, 0.07]} />{frame}</mesh>)}
        </group>
      ))}
      {[[-w / 4 - 0.6, w / 2 - 1.2], [w / 4 + 0.6, w / 2 - 1.2]].map(([x, ww]) => (
        <group key={x} position={[x, H / 2, d / 2]}>
          <mesh><boxGeometry args={[ww, H, 0.05]} />{glass}</mesh>
          <mesh position={[0, H / 2, 0]}><boxGeometry args={[ww, 0.06, 0.09]} />{frame}</mesh>
        </group>
      ))}
      {/* Videowall de dirección: tres pantallas */}
      <group position={[0, 1.75, -d / 2 + 0.12]}>
        <Box p={[0, 0, -0.04]} s={[5.6, 1.7, 0.08]} c="#0b0d12" rough={0.3} />
        {([["org", -1.85], ["finance", 0], ["crm", 1.85]] as const).map(([k, x]) => (
          <mesh key={k} position={[x, 0, 0.005]}>
            <planeGeometry args={[1.75, 1.5]} />
            <meshStandardMaterial map={lit ? screenTexture(k) : undefined} emissiveMap={lit ? screenTexture(k) : undefined} color={lit ? "#ffffff" : "#05060a"} emissive={lit ? "#ffffff" : "#000"} emissiveIntensity={lit ? 0.5 : 0} toneMapped={false} />
          </mesh>
        ))}
        <Box p={[2.6, -0.75, 0.01]} s={[0.08, 0.08, 0.01]} c={accent} e={accent} />
      </group>
      {/* Zona de visitas: sofá y mesa baja */}
      <group position={[-w / 2 + 1.4, 0, d / 2 - 1.5]} rotation-y={Math.PI / 2}>
        <RoundedBox args={[1.9, 0.38, 0.8]} radius={0.08} position={[0, 0.3, 0]} castShadow><meshStandardMaterial color="#2b3245" roughness={0.85} /></RoundedBox>
        <RoundedBox args={[1.9, 0.55, 0.18]} radius={0.06} position={[0, 0.62, -0.33]} castShadow><meshStandardMaterial color="#2b3245" roughness={0.85} /></RoundedBox>
        <mesh position={[0, 0.25, 1]}><cylinderGeometry args={[0.45, 0.45, 0.05, 28]} /><meshStandardMaterial color={OAK} roughness={0.4} /></mesh>
      </group>
    </group>
  );
}

/** Silla ergonómica: asiento y respaldo acolchados, reposabrazos y base de cinco radios. */
function Chair({ lit, accent }: { lit: boolean; accent: string }) {
  return (
    <group>
      <RoundedBox args={[0.62, 0.1, 0.58]} radius={0.04} smoothness={3} position={[0, 0.5, 0]} castShadow><meshStandardMaterial color={FABRIC} roughness={0.85} /></RoundedBox>
      <RoundedBox args={[0.6, 0.78, 0.09]} radius={0.04} smoothness={3} position={[0, 0.98, 0.31]} rotation-x={-0.1} castShadow><meshStandardMaterial color={FABRIC} roughness={0.85} /></RoundedBox>
      <mesh position={[0, 1.02, 0.36]} rotation-x={-0.1}><planeGeometry args={[0.36, 0.5]} /><meshStandardMaterial color={lit ? accent : "#2a3142"} side={2} /></mesh>
      {[-1, 1].map((s) => (
        <group key={s}>
          <mesh position={[0.32 * s, 0.62, 0.05]}><boxGeometry args={[0.05, 0.22, 0.05]} /><meshStandardMaterial color={METAL} /></mesh>
          <RoundedBox args={[0.08, 0.04, 0.32]} radius={0.015} position={[0.32 * s, 0.74, 0.02]}><meshStandardMaterial color="#1a1f2b" /></RoundedBox>
        </group>
      ))}
      <mesh position={[0, 0.27, 0]}><cylinderGeometry args={[0.035, 0.04, 0.44, 10]} /><meshStandardMaterial color={STEEL} metalness={0.8} roughness={0.25} /></mesh>
      {[0, 1, 2, 3, 4].map((i) => {
        const a = (i / 5) * Math.PI * 2;
        return (
          <group key={i} rotation-y={a}>
            <mesh position={[0, 0.06, 0.15]}><boxGeometry args={[0.05, 0.035, 0.3]} /><meshStandardMaterial color={METAL} metalness={0.5} /></mesh>
            <mesh position={[0, 0.03, 0.3]}><sphereGeometry args={[0.035, 8, 6]} /><meshStandardMaterial color="#0b0d12" /></mesh>
          </group>
        );
      })}
    </group>
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
  const staff = staffModelOf(agent.id);
  const desk = station.executive ? { w: 3.4, d: 1.3 } : { w: 2.6, d: 1.2 };
  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onSelect(agent.id);
  };
  const statusText = look.inactive ? "Inactivo" : AGENT_STATUS_LABEL[agent.status];
  const zoneColor = useMemo(() => `#${new Color(FLOOR).lerp(new Color(dept.color), lit ? 0.05 : 0.025).getHexString()}`, [dept.color, lit]);
  const edgeColor = useMemo(() => `#${new Color("#0b0f19").lerp(new Color(dept.color), lit ? 0.75 : 0.3).getHexString()}`, [dept.color, lit]);
  const { w: zw, d: zd } = station.zone;

  return (
    <group position={[station.x, 0, station.z]}>
      {/* Zona: moqueta del departamento con borde de luz y tótem con su nombre */}
      {!station.executive && (
        <group position={[station.zone.dx ?? 0, 0, station.zone.dz ?? 0]}>
          <mesh position-y={0.015} receiveShadow><boxGeometry args={[zw, 0.03, zd]} /><meshStandardMaterial color={zoneColor} roughness={0.95} /></mesh>
          {[[0, -zd / 2, zw, 0.05], [0, zd / 2, zw, 0.05], [-zw / 2, 0, 0.05, zd], [zw / 2, 0, 0.05, zd]].map(([x, z, w, d], i) => (
            <mesh key={i} position={[x, 0.032, z]}><boxGeometry args={[w, 0.008, d]} /><meshStandardMaterial color={edgeColor} emissive={edgeColor} emissiveIntensity={lit ? 0.6 : 0.1} /></mesh>
          ))}
        </group>
      )}
      <group position={[station.executive ? -zw / 2 + 0.7 : (zw / 2 - 0.5) * Math.sign(-station.x || 1), 0, station.executive ? zd / 2 - 0.4 : -(zd / 2 - 0.4)]}>
        <Box p={[0, 0.7, 0]} s={[0.08, 1.4, 0.08]} c={METAL} />
        <mesh position={[0, 1.35, 0.045]} castShadow>
          <planeGeometry args={[1.25, 0.39]} />
          <meshStandardMaterial map={signTexture(station.zone.label, dept.color)} emissiveMap={signTexture(station.zone.label, dept.color)} emissive="#ffffff" emissiveIntensity={lit ? 0.35 : 0.1} side={2} toneMapped={false} />
        </mesh>
      </group>

      {station.props.includes("glassOffice") && <GlassOffice station={station} lit={lit} accent={dept.color} />}

      <group rotation-y={station.rotation}>
        {/* Zona de clic: una caja invisible por puesto (el puntero solo se comprueba contra 9 cajas). */}
        <mesh
          position={[0, 1, 0.2]}
          visible={false}
          userData={{ dynamic: true }}
          onClick={click}
          onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = "pointer"; }}
          onPointerOut={() => (document.body.style.cursor = "")}
        >
          <boxGeometry args={[desk.w + 0.6, 2.2, 2.6]} />
          <meshBasicMaterial />
        </mesh>

        {/* Mesa: tablero de roble con cantos redondeados, alfombrilla y canaleta */}
        <RoundedBox args={[desk.w, 0.06, desk.d]} radius={0.025} smoothness={3} position={[0, 0.76, -0.25]} castShadow receiveShadow>
          <meshStandardMaterial color={lit ? OAK : "#5b4d40"} roughness={0.45} />
        </RoundedBox>
        {station.executive && (
          <RoundedBox args={[1.2, 0.06, 0.7]} radius={0.025} position={[desk.w / 2 + 0.2, 0.76, 0.2]} castShadow><meshStandardMaterial color={lit ? OAK : "#5b4d40"} roughness={0.45} /></RoundedBox>
        )}
        {[-1, 1].map((s) => (
          <group key={s}>
            <Box p={[s * (desk.w / 2 - 0.12), 0.37, -0.25]} s={[0.06, 0.74, desk.d - 0.15]} c={METAL} metal={0.6} rough={0.35} />
            <Box p={[s * (desk.w / 2 - 0.12), 0.02, -0.25]} s={[0.1, 0.04, desk.d - 0.05]} c={METAL} metal={0.6} rough={0.35} />
          </group>
        ))}
        <Box p={[0, 0.6, -0.25 - desk.d / 2 + 0.05]} s={[desk.w - 0.3, 0.12, 0.08]} c={METAL} />
        <Box p={[0, 0.795, 0.02]} s={[0.9, 0.006, 0.42]} c="#1a1f2b" rough={0.9} />
        {/* Monitores */}
        {station.second ? (
          <>
            <Monitor p={[-0.5, 1.02, -0.62]} r={0.12} kind={station.screen} look={look} lit={lit} />
            <Monitor p={[0.5, 1.02, -0.62]} r={-0.12} kind={station.second} look={look} lit={lit} />
          </>
        ) : (
          <Monitor p={[0, 1.04, -0.62]} w={1.15} kind={station.screen} look={look} lit={lit} />
        )}
        {/* Teclado, ratón y taza */}
        <Box p={[0, 0.81, -0.06]} s={[0.5, 0.02, 0.16]} c="#20263a" rough={0.5} />
        <mesh position={[0.4, 0.81, -0.04]} scale={[1, 0.5, 1.4]}><sphereGeometry args={[0.04, 12, 8]} /><meshStandardMaterial color="#20263a" /></mesh>
        <mesh position={[-0.55, 0.85, -0.4]} castShadow><cylinderGeometry args={[0.045, 0.04, 0.1, 14]} /><meshStandardMaterial color={dept.color} roughness={0.4} /></mesh>
        {/* Silla y trabajador: modelo 3D profesional si existe (carga diferida; mientras tanto, la figura) */}
        {staff ? (
          <group position={[0, 0, 0.56]}>
            <group scale={0.85 * staff.scale}>
              <Chair lit={lit} accent={dept.color} />
            </group>
            <Suspense fallback={<group scale={1.2} position={[0, 0.048, 0.024]}><Character agentId={agent.id} avatar={agent.avatar} look={look} reducedMotion={reducedMotion} /></group>}>
              <StaffModel model={staff} avatar={agent.avatar} look={look} reducedMotion={reducedMotion} />
            </Suspense>
            <group scale={1.2} userData={{ dynamic: true }}>
              <StatusMark look={look} reducedMotion={reducedMotion} />
            </group>
          </group>
        ) : (
          <group position={[0, 0, 0.56]} scale={1.2}>
            <Chair lit={lit} accent={dept.color} />
            <group position={[0, 0.04, 0.02]}>
              <Character agentId={agent.id} avatar={agent.avatar} look={look} reducedMotion={reducedMotion} />
            </group>
            <group userData={{ dynamic: true }}>
              <StatusMark look={look} reducedMotion={reducedMotion} />
            </group>
          </group>
        )}
        {station.props.map((p) => <Prop key={p} kind={p} lit={lit} accent={dept.color} look={look} />)}
        {/* Foco suave del puesto seleccionado */}
        {selected && (
          <mesh rotation-x={-Math.PI / 2} position={[0, 0.04, 0.2]} userData={{ dynamic: true }}>
            <ringGeometry args={[1.5, 1.62, 64]} />
            <meshBasicMaterial color="#5b7bff" transparent opacity={0.8} />
          </mesh>
        )}
      </group>

      <Html position={[0, 3.2, 0]} center zIndexRange={[20, 0]} portal={labels as RefObject<HTMLElement>}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSelect(agent.id);
          }}
          aria-pressed={selected}
          aria-label={`${agent.name}, ${agent.role}: ${look.inactive ? "inactivo, fuera del piloto" : AGENT_STATUS_LABEL[agent.status]}`}
          className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ring-1 transition-colors ${
            selected ? "bg-cobalt text-white ring-cobalt-soft" : "bg-[#0b0f19]/90 text-paper ring-white/10 hover:ring-cobalt-soft"
          } ${look.inactive && !selected ? "opacity-70" : ""}`}
        >
          <span className="size-2 rounded-full" style={{ background: look.inactive ? "#667085" : look.ring }} />
          {agent.name}
          {!compact && <span className="font-normal text-paper/60">· {statusText}</span>}
        </button>
      </Html>
    </group>
  );
}
