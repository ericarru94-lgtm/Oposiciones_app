// PNG del retrato → WebP 256×256 con transparencia y sin metadatos (fase 4.3.2).
import sharp from 'sharp';
const [src, out] = process.argv.slice(2);
// Recorte cuadrado centrado y WebP con transparencia; sharp no copia metadatos salvo que se pida (withMetadata).
await sharp(src).resize(256, 256, { kernel: 'lanczos3' }).webp({ quality: 86, alphaQuality: 90, effort: 6 }).toFile(out);
const m = await sharp(out).metadata();
console.log(out.split('/').pop(), m.width + 'x' + m.height, m.format, 'alpha', m.hasAlpha, 'exif', !!m.exif, 'icc', !!m.icc, 'xmp', !!m.xmp);
