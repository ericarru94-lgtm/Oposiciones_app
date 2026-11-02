// Postproceso de un personaje MPFB para la web (fases 4.3 y 4.3.1).
// Uso (con @gltf-transform/core|extensions|functions 4.5, meshoptimizer y sharp instalados aparte):
//   node postproceso.mjs entrada.glb salida.glb [textura_ojos.png] [#tonoPiel]         (fases 4.3 y 4.3.1)
//   node postproceso.mjs entrada.glb salida.glb ficha.json <carpeta_pack> <carpeta_ropa> (fase 4.4: lee
//     «postproceso» de la ficha: ojos_textura, tono_piel, pelo_color y las texturas de ropa recoloreadas
//     por recolorear_ropa.py)
// Transparencia por pieza, rugosidad, color de ojos, tono de piel (factor de color) y texturas a 1024 px WebP.
// Sin meshopt: su cuantización duplica el esqueleto por pieza.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
const [inp, out] = args;
let eyeTex = args[2], skinHex = args[3], hairHex = null, clothes = {};
if (args[2]?.endsWith('.json')) {
  const post = JSON.parse(readFileSync(args[2], 'utf8')).postproceso ?? {};
  const [pack, ropaDir] = [args[3], args[4]];
  eyeTex = post.ojos_textura && join(pack, post.ojos_textura);
  skinHex = post.tono_piel; hairHex = post.pelo_color ?? null;
  clothes = Object.fromEntries(Object.keys(post.ropa ?? {}).map((k) => [k, join(ropaDir, `${k}_diffuse.png`)]));
}
await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(inp);
for (const m of doc.getRoot().listMaterials()) {
  const n = m.getName();
  if (/eyebrow|eyelash|hair|short0|long0|bob0|braid|ponytail|afro/i.test(n)) { m.setAlphaMode('MASK').setAlphaCutoff(0.35).setDoubleSided(true); }
  else if (/high-poly|low-poly/i.test(n)) { m.setAlphaMode('MASK').setAlphaCutoff(0.5).setDoubleSided(false); }
  else { m.setAlphaMode('OPAQUE').setDoubleSided(false); }
  m.setRoughnessFactor(/body/i.test(n) ? 0.55 : /high-poly|eye/i.test(n) ? 0.15 : 0.8).setMetallicFactor(0);
}
// Tono de piel y color de pelo: factor de color sobre la textura (conserva el detalle) para acercar su tono medio
// al del avatar del agente.
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
async function matchColor(m, hex, label, { minAlpha, minSum }) {
  const img = sharp(Buffer.from(m.getBaseColorTexture().getImage()));
  // Media solo de los píxeles útiles: se ignoran el fondo vacío del mapa UV y las zonas transparentes.
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const sum = [0, 0, 0]; let n = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i + 3] < minAlpha || data[i] + data[i + 1] + data[i + 2] < minSum) continue;
    sum[0] += lin(data[i] / 255); sum[1] += lin(data[i + 1] / 255); sum[2] += lin(data[i + 2] / 255); n++;
  }
  const target = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255));
  const mean = sum.map((v) => v / Math.max(1, n));
  let f = target.map((t, i) => t / mean[i]);
  // Un factor solo puede oscurecer: si la textura ya es más oscura que el tono buscado, se ajusta solo el matiz
  // (el canal mayor queda a 1). Si todos los canales oscurecen (caso de Alex), se aplica tal cual.
  const top = Math.max(...f);
  f = top > 1 ? f.map((v) => v / top) : f;
  m.setBaseColorFactor([...f, 1]);
  console.log(`factor ${label}`, f.map((v) => v.toFixed(3)).join(' '));
}
for (const m of doc.getRoot().listMaterials()) {
  if (!m.getBaseColorTexture()) continue;
  if (skinHex && /body/i.test(m.getName())) await matchColor(m, skinHex, 'piel', { minAlpha: 200, minSum: 90 });
  if (hairHex && /short0|long0|bob0|braid|ponytail|afro/i.test(m.getName())) await matchColor(m, hairHex, 'pelo', { minAlpha: 128, minSum: 0 });
}
// Ropa recoloreada (recolorear_ropa.py): sustituye la textura de la prenda por su versión teñida.
for (const m of doc.getRoot().listMaterials()) for (const [prenda, file] of Object.entries(clothes)) {
  if (m.getName().includes(prenda)) { m.getBaseColorTexture()?.setImage(new Uint8Array(readFileSync(file))).setMimeType('image/png'); console.log('ropa', prenda); }
}
// Color de ojos: sustituye la imagen del material de los ojos por otra del mismo pack CC0.
if (eyeTex) for (const m of doc.getRoot().listMaterials()) if (/high-poly|low-poly/i.test(m.getName())) m.getBaseColorTexture()?.setImage(new Uint8Array(readFileSync(eyeTex))).setMimeType('image/png');
await doc.transform(dedup(), prune(), weld(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 88 }),
  // Sin meshopt: su cuantización exige un esqueleto por pieza (7 en vez de 1). Ver el informe.
  );
await io.write(out, doc);
console.log('ok', out);
