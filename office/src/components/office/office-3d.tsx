"use client";

// Oficina 3D. Solo dibuja: recibe el estado real de los agentes y no tiene
// acciones (no llama al servidor ni a herramientas). Se carga en diferido
// (next/dynamic, sin SSR) solo cuando la vista 3D está activa.

import { ContactShadows, OrbitControls, OrthographicCamera } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { needsAnimation, sceneLook } from "@/lib/office/scene";
import { focusPoint, OFFICE_SIZE, stationOf } from "@/lib/office/layout";
import { Baked } from "./scene/baked";
import { Environment } from "./scene/environment";
import { Workstation } from "./scene/workstation";
import type { OfficeAgent, OfficeAgentData } from "./types";

/** Mantiene el bucle de dibujo solo mientras hay algo en curso de verdad. */
function Animator({ active }: { active: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  useFrame(() => {
    if (active) invalidate();
  });
  return null;
}

// Escritorio: isométrica clásica (~34° de elevación). Móvil vertical: vista
// lateral más cenital para que la planta ocupe el alto de la pantalla.
const VIEW = {
  wide: { azimuth: Math.PI / 4, polar: 0.98 },
  compact: { azimuth: Math.PI / 2 - 0.2, polar: 1.0 },
} as const;
const HOME = new Vector3(-0.2, 0.6, 0);

function viewOffset(azimuth: number, polar: number) {
  const r = 40;
  return new Vector3(Math.sin(polar) * Math.sin(azimuth) * r, Math.cos(polar) * r, Math.sin(polar) * Math.cos(azimuth) * r);
}

/**
 * Encuadre y acercamiento. Sin selección: toda la planta ajustada a la
 * pantalla. Con selección: se acerca al puesto. La transición se dibuja solo
 * mientras dura (frameloop «demand») y se corta si el usuario mueve la cámara.
 */
function CameraRig({ focusId, compact, reducedMotion }: { focusId: string | null; compact: boolean; reducedMotion: boolean }) {
  const { azimuth, polar } = compact ? VIEW.compact : VIEW.wide;
  const { camera, size, invalidate, gl, scene } = useThree();
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const tween = useRef<{ target: Vector3; zoom: number } | null>(null);
  // Solo en desarrollo: permite inspeccionar la cámara desde las pruebas de navegador.
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") (window as unknown as { __officeCamera?: unknown }).__officeCamera = { camera, controls, size, gl, scene };
  }, [camera, controls, size, gl, scene]);

  // Ancho y alto proyectados de la planta según el ángulo de la cámara.
  const fit = useMemo(() => {
    // Ancho y alto que ocupa la planta en pantalla (en metros) con la vista actual.
    const { w, d } = OFFICE_SIZE;
    const projW = w * Math.abs(Math.cos(azimuth)) + d * Math.abs(Math.sin(azimuth)) + 1.2;
    const projH = (w * Math.abs(Math.sin(azimuth)) + d * Math.abs(Math.cos(azimuth))) * Math.cos(polar) + 3.2 * Math.sin(polar) + 1.6;
    return Math.max(8, Math.min(size.width / projW, size.height / projH));
  }, [azimuth, polar, size.width, size.height]);

  useEffect(() => {
    if (!controls) return;
    const s = focusId ? stationOf(focusId) : undefined;
    const target = s ? new Vector3(...focusPoint(s)) : HOME.clone();
    // En escritorio la ficha ocupa el lado derecho: el puesto se encuadra a su izquierda.
    if (s && !compact) target.add(new Vector3(Math.cos(azimuth), 0, -Math.sin(azimuth)).multiplyScalar(2.4));
    const zoom = s ? fit * (compact ? 2.6 : 2.3) : fit;
    controls.minZoom = fit * 0.8;
    controls.maxZoom = fit * 5;
    if (reducedMotion) {
      const delta = target.clone().sub(controls.target);
      controls.target.copy(target);
      camera.position.add(delta);
      camera.zoom = zoom;
      camera.updateProjectionMatrix();
      controls.update();
      invalidate();
      return;
    }
    tween.current = { target, zoom };
    invalidate();
  }, [focusId, fit, compact, azimuth, reducedMotion, controls, camera, invalidate]);

  // El usuario manda: si toca la cámara, se cancela la transición.
  useEffect(() => {
    if (!controls) return;
    const stop = () => (tween.current = null);
    controls.addEventListener("start", stop);
    return () => controls.removeEventListener("start", stop);
  }, [controls]);

  // Encuadre inicial (sin animación).
  useEffect(() => {
    camera.position.copy(HOME.clone().add(viewOffset(azimuth, polar)));
    camera.zoom = fit;
    camera.updateProjectionMatrix();
    controls?.target.copy(HOME);
    controls?.update();
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [azimuth, polar, controls]);

  useFrame((_, dt) => {
    const t = tween.current;
    if (!t || !controls) return;
    const k = 1 - Math.exp(-dt * 6);
    const next = controls.target.clone().lerp(t.target, k);
    camera.position.add(next.clone().sub(controls.target));
    controls.target.copy(next);
    camera.zoom += (t.zoom - camera.zoom) * k;
    camera.updateProjectionMatrix();
    controls.update();
    if (next.distanceTo(t.target) < 0.01 && Math.abs(camera.zoom - t.zoom) < 0.05) tween.current = null;
    invalidate();
  });
  return null;
}

/** Mantiene el punto de mira dentro de la planta al desplazarse. */
function clampTarget(c: OrbitControlsImpl) {
  const t = c.target;
  const hx = OFFICE_SIZE.w / 2 - 1, hz = OFFICE_SIZE.d / 2 - 1;
  const cx = Math.max(-hx, Math.min(hx, t.x)), cz = Math.max(-hz, Math.min(hz, t.z));
  if (cx !== t.x || cz !== t.z) {
    c.object.position.x += cx - t.x;
    c.object.position.z += cz - t.z;
    t.x = cx;
    t.z = cz;
  }
}

export default function Office3D({
  agents, selectedId, onSelect, reducedMotion, compact = false,
}: {
  agents: OfficeAgentData[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  reducedMotion: boolean;
  /** Pantalla estrecha: vista girada para aprovechar el alto y etiquetas cortas. */
  compact?: boolean;
}) {
  // Contenedor propio para las etiquetas HTML: se desmontan limpias al cambiar de vista.
  const labels = useRef<HTMLDivElement>(null);
  const withLook: OfficeAgent[] = useMemo(() => agents.map((a) => ({ ...a, look: sceneLook(a.id, a.status) })), [agents]);
  const animate = needsAnimation(agents, reducedMotion);
  const { azimuth } = compact ? VIEW.compact : VIEW.wide;
  // El mobiliario solo cambia si cambia quién está en el piloto (no con el estado).
  const bakeKey = agents.map((a) => `${a.id}:${a.pilot ? 1 : 0}`).join(",");

  return (
    <div className="relative size-full" data-testid="office-3d">
    <Canvas
      frameloop="demand"
      dpr={[1, 1.5]}
      shadows={false}
      gl={{ antialias: true, powerPreference: compact ? "low-power" : "high-performance" }}
      onPointerMissed={(e) => {
        // Solo un toque en el suelo vacío deselecciona (no las etiquetas HTML).
        if ((e.target as HTMLElement | null)?.tagName === "CANVAS") onSelect(null);
      }}
      aria-label="Oficina 3D de HE Signal"
      onCreated={({ gl }) => {
        gl.toneMappingExposure = 1.2;
      }}
    >
      <color attach="background" args={["#070a12"]} />
      <fog attach="fog" args={["#070a12", 55, 90]} />
      {/* Posición y zoom los fija CameraRig (props en línea se reaplicarían en cada render). */}
      <OrthographicCamera makeDefault near={-100} far={300} />
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.12}
        enableRotate
        rotateSpeed={0.5}
        zoomSpeed={0.9}
        panSpeed={0.8}
        screenSpacePanning
        minPolarAngle={compact ? 0.7 : 0.72}
        maxPolarAngle={compact ? 1.2 : 1.18}
        minAzimuthAngle={azimuth - 0.75}
        maxAzimuthAngle={azimuth + 0.75}
        onChange={(e) => e && clampTarget(e.target as OrbitControlsImpl)}
      />
      <CameraRig focusId={selectedId} compact={compact} reducedMotion={reducedMotion} />
      {/* Luz: ambiente frío, relleno cálido desde los ventanales y clave suave */}
      <hemisphereLight args={["#dfe6ff", "#2a2118", 1.25]} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[10, 18, 8]} intensity={2.1} color="#fff1df" />
      <directionalLight position={[-12, 9, -6]} intensity={0.6} color="#7f95ff" />
      <Animator active={animate} />
      <Baked version={bakeKey}>
      <Environment />
      <ContactShadows position={[0, 0.01, 0]} scale={[OFFICE_SIZE.w, OFFICE_SIZE.d]} resolution={1024} blur={2.2} opacity={0.55} far={2.5} frames={1} />
      {withLook.map((a) => {
        const station = stationOf(a.id);
        return station ? (
          <Workstation key={a.id} agent={a} station={station} selected={a.id === selectedId} onSelect={onSelect} reducedMotion={reducedMotion} labels={labels} compact={compact} />
        ) : null;
      })}
      </Baked>
    </Canvas>
    <div ref={labels} className="pointer-events-none absolute inset-0 overflow-hidden [&_button]:pointer-events-auto" />
    </div>
  );
}
