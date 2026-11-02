// Niveles de detalle (LOD) de un personaje ya postprocesado (fase 4.3.1).
// Uso: node niveles-detalle.mjs entrada.glb salida.glb ratio tamañoTextura [error] [libre]
//   LOD1: ratio 0.5, texturas 512, error 0.002 (bordes fijos).  LOD2: ratio 0.12, texturas 256, error 0.02, «libre».
// Simplificador de meshoptimizer: conserva pesos de piel y un solo esqueleto.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { simplify, weld, prune, dedup, textureCompress } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
const [inp, out, ratio, tex] = process.argv.slice(2);
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(inp);
await doc.transform(
  weld(),
  // Las cejas, las pestañas y los ojos son pequeños: se simplifican menos para no deformar la cara.
  simplify({ simplifier: MeshoptSimplifier, ratio: +ratio, error: +(process.argv[6] ?? 0.002), lockBorder: process.argv[7] !== 'libre' }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [+tex, +tex], quality: 85 }),
  dedup(), prune(),
);
await io.write(out, doc);
let tris = 0; for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) tris += p.getIndices().getCount() / 3;
console.log(out.split('/').pop(), 'tris', tris, 'skins', doc.getRoot().listSkins().length);
