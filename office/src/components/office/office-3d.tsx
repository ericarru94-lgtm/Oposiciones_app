"use client";

// Sede 3D. Solo dibuja: recibe el estado real de los agentes y no tiene
// acciones (no llama al servidor ni a herramientas). Se carga en diferido
// (next/dynamic, sin SSR) solo cuando la vista 3D está activa.

import { ContactShadows, OrbitControls, OrthographicCamera } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { PCFSoftShadowMap, PMREMGenerator, Vector3, type DirectionalLight } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { needsAnimation, sceneLook } from "@/lib/office/scene";
import { focusPoint, OFFICE_SIZE, stationOf } from "@/lib/office/layout";
import { Baked } from "./scene/baked";
import { Environment } from "./scene/environment";
import { Workstation } from "./scene/workstation";
import type { OfficeAgent, OfficeAgentData } from "./types";

export type CameraMode = "home" | "overview";

/** Mantiene el bucle de dibujo solo mientras hay algo en curso de verdad. */
function Animator({ active }: { active: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  useFrame(() => {
    if (active) invalidate();
  });
  return null;
}

// Escritorio: isométrica clásica. Móvil vertical: vista lateral en diagonal.
const VIEW = {
  wide: { azimuth: Math.PI / 4, polar: 0.98 },
  compact: { azimuth: Math.PI / 2 - 0.2, polar: 1.0 },
} as const;

/** Regiones que encuadra la cámara (centro y tamaño en metros). */
const REGIONS = {
  overview: { x: 0, z: 0, w: OFFICE_SIZE.w, d: OFFICE_SIZE.d },
  // Vista inicial: la zona de trabajo, lo bastante cerca para reconocer a los trabajadores.
  home: { x: -5, z: -4, w: 21, d: 15 },
  // Móvil: arranca sobre los agentes activos del piloto (Alex, Marcus y Sofia).
  homeCompact: { x: -7.5, z: -5, w: 19, d: 15 },
} as const;

function viewOffset(azimuth: number, polar: number) {
  const r = 60;
  return new Vector3(Math.sin(polar) * Math.sin(azimuth) * r, Math.cos(polar) * r, Math.sin(polar) * Math.cos(azimuth) * r);
}

function fitZoom(region: { w: number; d: number }, azimuth: number, polar: number, width: number, height: number) {
  const projW = region.w * Math.abs(Math.cos(azimuth)) + region.d * Math.abs(Math.sin(azimuth)) + 1;
  const projH = (region.w * Math.abs(Math.sin(azimuth)) + region.d * Math.abs(Math.cos(azimuth))) * Math.cos(polar) + 3.4 * Math.sin(polar) + 1.2;
  return Math.max(5, Math.min(width / projW, height / projH));
}

/** Mapa de entorno generado en el navegador (sin descargas): reflejos en suelo, vidrio y metal. */
function SceneEnvironment() {
  const { gl, scene, invalidate } = useThree();
  useEffect(() => {
    const pmrem = new PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.55;
    invalidate();
    return () => {
      scene.environment = null;
      env.dispose();
      pmrem.dispose();
    };
  }, [gl, scene, invalidate]);
  return null;
}

export type Quality = "high" | "low";

/**
 * Mide una sola vez lo que tarda en dibujarse la escena completa. Si el equipo
 * no llega (GPU integrada antigua o sin aceleración), se pasa a calidad baja:
 * sin mapa de reflejos ni sombras proyectadas (las sombras de contacto se quedan).
 */
function QualityProbe({ onLow, onDone }: { onLow: () => void; onDone: () => void }) {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    const id = window.setTimeout(() => {
      const ctx = gl.getContext();
      const px = new Uint8Array(4);
      const t = performance.now();
      for (let i = 0; i < 3; i++) {
        gl.render(scene, camera);
        ctx.readPixels(0, 0, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
      }
      if ((performance.now() - t) / 3 > 40) onLow();
      onDone();
    }, 1500);
    return () => window.clearTimeout(id);
  }, [gl, scene, camera, onLow, onDone]);
  return null;
}

/** Calidad baja: apaga las sombras proyectadas y recompila los materiales una vez. */
function LowQuality() {
  const { gl, scene, invalidate, setDpr } = useThree();
  useEffect(() => {
    gl.shadowMap.enabled = false;
    setDpr(1);
    scene.traverse((o) => {
      const m = (o as { material?: { needsUpdate: boolean } | { needsUpdate: boolean }[] }).material;
      if (Array.isArray(m)) m.forEach((x) => (x.needsUpdate = true));
      else if (m) m.needsUpdate = true;
    });
    invalidate();
  }, [gl, scene, invalidate, setDpr]);
  return null;
}

/** Sombras reales calculadas una vez (y de nuevo solo si cambia la escena), no en cada fotograma. */
function StaticShadows({ version }: { version: string }) {
  const { gl, invalidate } = useThree();
  useEffect(() => {
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
    invalidate();
  }, [gl, version, invalidate]);
  return null;
}

/**
 * Encuadre y acercamiento. «home»: zona de trabajo; «overview»: toda la sede;
 * con selección: el puesto. La transición se dibuja solo mientras dura y se
 * corta si el usuario mueve la cámara.
 */
function CameraRig({ focusId, mode, compact, reducedMotion }: { focusId: string | null; mode: CameraMode; compact: boolean; reducedMotion: boolean }) {
  const { camera, size, invalidate, gl, scene } = useThree();
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const tween = useRef<{ target: Vector3; zoom: number } | null>(null);
  const { azimuth, polar } = compact ? VIEW.compact : VIEW.wide;

  // Solo en desarrollo: permite inspeccionar la cámara desde las pruebas de navegador.
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") (window as unknown as { __officeCamera?: unknown }).__officeCamera = { camera, controls, size, gl, scene };
  }, [camera, controls, size, gl, scene]);

  const goal = useMemo(() => {
    const s = focusId ? stationOf(focusId) : undefined;
    const region = mode === "overview" ? REGIONS.overview : compact ? REGIONS.homeCompact : REGIONS.home;
    const base = fitZoom(region, azimuth, polar, size.width, size.height);
    if (s) {
      const target = new Vector3(...focusPoint(s));
      // En escritorio la ficha ocupa el lado derecho: el puesto se encuadra a su izquierda.
      if (!compact) target.add(new Vector3(Math.cos(azimuth), 0, -Math.sin(azimuth)).multiplyScalar(3.2));
      const zoom = fitZoom({ w: s.zone.w * 0.7, d: s.zone.d * 0.7 }, azimuth, polar, size.width * (compact ? 1 : 0.62), size.height);
      return { target, zoom, base };
    }
    return { target: new Vector3(region.x, 0.8, region.z), zoom: base, base };
  }, [focusId, mode, compact, azimuth, polar, size.width, size.height]);

  useEffect(() => {
    if (!controls) return;
    controls.minZoom = fitZoom(REGIONS.overview, azimuth, polar, size.width, size.height) * 0.85;
    controls.maxZoom = goal.base * 6;
    if (reducedMotion) {
      camera.position.add(goal.target.clone().sub(controls.target));
      controls.target.copy(goal.target);
      camera.zoom = goal.zoom;
      camera.updateProjectionMatrix();
      controls.update();
      invalidate();
      return;
    }
    tween.current = { target: goal.target.clone(), zoom: goal.zoom };
    invalidate();
  }, [goal, reducedMotion, controls, camera, invalidate, azimuth, polar, size.width, size.height]);

  // El usuario manda: si toca la cámara, se cancela la transición.
  useEffect(() => {
    if (!controls) return;
    const stop = () => (tween.current = null);
    controls.addEventListener("start", stop);
    return () => controls.removeEventListener("start", stop);
  }, [controls]);

  // Encuadre inicial (sin animación).
  useEffect(() => {
    camera.position.copy(goal.target.clone().add(viewOffset(azimuth, polar)));
    camera.zoom = goal.zoom;
    camera.updateProjectionMatrix();
    controls?.target.copy(goal.target);
    controls?.update();
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [azimuth, polar, controls]);

  useFrame((_, dt) => {
    const t = tween.current;
    if (!t || !controls) return;
    const k = 1 - Math.exp(-dt * 5);
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

function KeyLight() {
  const ref = useRef<DirectionalLight>(null);
  useEffect(() => {
    const l = ref.current;
    if (!l) return;
    const c = l.shadow.camera;
    c.left = -26; c.right = 26; c.top = 22; c.bottom = -22; c.near = 1; c.far = 90;
    c.updateProjectionMatrix();
    l.target.position.set(0, 0, 0);
    l.target.updateMatrixWorld();
  }, []);
  return (
    <directionalLight
      ref={ref}
      position={[18, 30, 14]}
      intensity={2.2}
      color="#fff1df"
      castShadow
      shadow-mapSize={[2048, 2048]}
      shadow-bias={-0.0004}
      shadow-normalBias={0.03}
    />
  );
}

export default function Office3D({
  agents, selectedId, onSelect, reducedMotion, compact = false, mode = "home",
}: {
  agents: OfficeAgentData[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  reducedMotion: boolean;
  /** Pantalla estrecha: vista girada para aprovechar el alto y etiquetas cortas. */
  compact?: boolean;
  mode?: CameraMode;
}) {
  // Contenedor propio para las etiquetas HTML: se desmontan limpias al cambiar de vista.
  const labels = useRef<HTMLDivElement>(null);
  const [quality, setQuality] = useState<Quality>("high");
  // «?calidad=alta|baja» fija la calidad y desactiva la medición automática (pruebas y equipos concretos).
  const [forced] = useState<Quality | null>(() => {
    const q = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("calidad");
    return q === "alta" ? "high" : q === "baja" ? "low" : null;
  });
  const effective = forced ?? quality;
  const goLow = useMemo(() => () => setQuality("low"), []);
  const [probed, setProbed] = useState(false);
  const probeDone = useMemo(() => () => setProbed(true), []);
  const withLook: OfficeAgent[] = useMemo(() => agents.map((a) => ({ ...a, look: sceneLook(a.id, a.status) })), [agents]);
  const animate = needsAnimation(agents, reducedMotion);
  const { azimuth } = compact ? VIEW.compact : VIEW.wide;
  // El mobiliario solo cambia si cambia quién está en el piloto (no con el estado).
  const bakeKey = agents.map((a) => `${a.id}:${a.pilot ? 1 : 0}`).join(",");
  // Las sombras se recalculan si cambia algún estado (postura o pantalla), nunca en cada fotograma.
  const shadowKey = withLook.map((a) => `${a.id}:${a.look.pose}:${a.look.screen}`).join(",");

  return (
    <div className="relative size-full" data-testid="office-3d" data-quality={effective} data-quality-ready={forced || probed ? "1" : undefined}>
      <Canvas
        frameloop="demand"
        dpr={[1, 1.5]}
        shadows={{ type: PCFSoftShadowMap }}
        gl={{ antialias: true, powerPreference: compact ? "low-power" : "high-performance" }}
        onPointerMissed={(e) => {
          // Solo un toque en el suelo vacío deselecciona (no las etiquetas HTML).
          if ((e.target as HTMLElement | null)?.tagName === "CANVAS") onSelect(null);
        }}
        aria-label="Sede 3D de HE Signal"
        onCreated={({ gl }) => {
          gl.toneMappingExposure = 1.05;
        }}
      >
        <color attach="background" args={["#070a12"]} />
        {/* Posición y zoom los fija CameraRig (props en línea se reaplicarían en cada render). */}
        <OrthographicCamera makeDefault near={-150} far={400} />
        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.12}
          enableRotate
          rotateSpeed={0.45}
          zoomSpeed={0.9}
          panSpeed={0.85}
          screenSpacePanning
          minPolarAngle={compact ? 0.7 : 0.72}
          maxPolarAngle={compact ? 1.2 : 1.18}
          minAzimuthAngle={azimuth - 0.75}
          maxAzimuthAngle={azimuth + 0.75}
          onChange={(e) => e && clampTarget(e.target as OrbitControlsImpl)}
        />
        <CameraRig focusId={selectedId} mode={mode} compact={compact} reducedMotion={reducedMotion} />
        {effective === "high" ? (
          <>
            <SceneEnvironment />
            <StaticShadows version={`${bakeKey}|${shadowKey}`} />
            {!forced && !probed && <QualityProbe onLow={goLow} onDone={probeDone} />}
          </>
        ) : (
          <LowQuality />
        )}
        {/* Luz: clave cálida con sombras, relleno frío desde los ventanales y ambiente suave */}
        <hemisphereLight args={["#dfe6ff", "#2a2118", effective === "high" ? 0.55 : 1]} />
        {effective === "low" && <ambientLight intensity={0.45} />}
        <KeyLight />
        <directionalLight position={[-20, 12, -10]} intensity={0.45} color="#7f95ff" />
        <Animator active={animate} />
        <Baked version={bakeKey}>
          <Environment />
          {withLook.map((a) => {
            const station = stationOf(a.id);
            return station ? (
              <Workstation key={a.id} agent={a} station={station} selected={a.id === selectedId} onSelect={onSelect} reducedMotion={reducedMotion} labels={labels} compact={compact} />
            ) : null;
          })}
        </Baked>
        <ContactShadows position={[0, 0.006, 0]} scale={[OFFICE_SIZE.w, OFFICE_SIZE.d]} resolution={1024} blur={2.4} opacity={0.35} far={1.6} frames={1} />
      </Canvas>
      <div ref={labels} className="pointer-events-none absolute inset-0 overflow-hidden [&_button]:pointer-events-auto" />
    </div>
  );
}
