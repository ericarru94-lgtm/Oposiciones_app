"use client";

// Fusiona la geometría ESTÁTICA de un subárbol en una malla por material para
// reducir las llamadas de dibujo (de cientos a unas decenas). Las mallas
// originales quedan ocultas pero siguen en la escena, así que los clics sobre
// el mobiliario funcionan igual. Todo lo marcado con userData.dynamic
// (pantallas, personajes, marcas de estado, selección) no se toca: sigue
// respondiendo al estado real en cada render.

import { useThree } from "@react-three/fiber";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { Group, Matrix4, Mesh, type BufferGeometry, type Material, type MeshStandardMaterial, type Object3D } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** Propiedades visibles del material: dos piezas con la misma clave se pueden dibujar juntas. */
function materialKey(m: Material): string {
  const s = m as MeshStandardMaterial & { map?: { uuid: string } | null; side?: number };
  return [
    m.type,
    s.color?.getHexString?.() ?? "",
    s.emissive?.getHexString?.() ?? "",
    s.emissiveIntensity ?? 0,
    s.roughness ?? 0,
    s.metalness ?? 0,
    m.transparent ? 1 : 0,
    m.opacity,
    s.map?.uuid ?? "",
    s.side ?? 0,
    m.toneMapped ? 1 : 0,
    s.flatShading ? 1 : 0,
  ].join("|");
}

/** Dinámico si él o algún antecesor HASTA la raíz de esta fusión lleva userData.dynamic. */
function isDynamic(o: Object3D, root: Object3D): boolean {
  for (let p: Object3D | null = o; p && p !== root; p = p.parent) if (p.userData?.dynamic) return true;
  return false;
}

export function Baked({ children, version }: { children: ReactNode; version: string }) {
  const root = useRef<Group>(null);
  const merged = useRef<Mesh[]>([]);
  const hidden = useRef<Mesh[]>([]);
  const invalidate = useThree((s) => s.invalidate);

  useLayoutEffect(() => {
    const g = root.current;
    if (!g) return;
    g.updateWorldMatrix(true, true);
    const toLocal = new Matrix4().copy(g.matrixWorld).invert();
    const buckets = new Map<string, { material: Material; geos: BufferGeometry[] }>();
    const sources: Mesh[] = [];
    g.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh || merged.current.includes(mesh) || isDynamic(mesh, g) || Array.isArray(mesh.material)) return;
      // Nada oculto (por sí o por un antecesor) se fusiona: aparecería siempre visible.
      if (!mesh.visible && !hidden.current.includes(mesh)) return;
      for (let p = mesh.parent; p && p !== g; p = p.parent) if (!p.visible) return;
      let geo = mesh.geometry.clone();
      geo.applyMatrix4(new Matrix4().multiplyMatrices(toLocal, mesh.matrixWorld));
      // Atributos homogéneos para poder fusionar (posición, normal y, si hay, uv).
      for (const name of Object.keys(geo.attributes)) if (!["position", "normal", "uv"].includes(name)) geo.deleteAttribute(name);
      if (geo.index) geo = geo.toNonIndexed();
      const key = `${materialKey(mesh.material as Material)}|${geo.attributes.uv ? "uv" : "-"}`;
      const b = buckets.get(key) ?? { material: mesh.material as Material, geos: [] };
      b.geos.push(geo);
      buckets.set(key, b);
      sources.push(mesh);
    });
    const out: Mesh[] = [];
    for (const { material, geos } of buckets.values()) {
      const geometry = mergeGeometries(geos, false);
      if (geometry) out.push(new Mesh(geometry, material));
      geos.forEach((x) => x.dispose());
    }
    for (const m of out) {
      m.matrixAutoUpdate = false;
      m.userData.baked = true;
      // Los clics los recogen las piezas originales (ocultas pero presentes).
      m.raycast = () => {};
      g.add(m);
    }
    for (const s of sources) s.visible = false;
    merged.current = out;
    hidden.current = sources;
    invalidate();
    return () => {
      for (const m of out) {
        g.remove(m);
        m.geometry.dispose();
      }
      for (const s of sources) s.visible = true;
      merged.current = [];
      hidden.current = [];
    };
  }, [version, invalidate]);

  return <group ref={root}>{children}</group>;
}
