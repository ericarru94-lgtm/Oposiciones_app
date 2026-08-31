#!/usr/bin/env node
/**
 * Postbuild: añade al precache del service worker (dist/service-worker.js)
 * los archivos JS/CSS con nombre "hasheado" que Vite acaba de generar
 * (dist/assets/index-<hash>.js, etc.), leyéndolos del propio dist/index.html
 * ya construido.
 *
 * Por qué hace falta: sin esto, esos archivos solo se cachean la primera
 * vez que el fetch handler del service worker los intercepta — y esa
 * primera vez casi nunca ocurre en la primerísima visita, porque el
 * navegador ya ha empezado a pedir el JS/CSS del documento antes de que el
 * service worker termine de instalarse y activarse (no llega a tiempo de
 * controlar esas peticiones). Precachearlos aquí, en el evento `install`,
 * asegura que queden en caché en cuanto el service worker termina de
 * activarse, sin depender de una segunda visita para que el offline
 * "básico" (recargar sin red) funcione.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, "..", "dist");
const indexHtmlPath = path.join(distDir, "index.html");
const swPath = path.join(distDir, "service-worker.js");

const html = readFileSync(indexHtmlPath, "utf8");
const assets = new Set();
for (const m of html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) assets.add(m[1]);

const sw = readFileSync(swPath, "utf8");
const rutasRegex = /const RUTAS_INICIALES = \[[^\]]*\];/;
if (!rutasRegex.test(sw)) {
  console.error("No se encontró RUTAS_INICIALES en dist/service-worker.js — ¿cambió el formato del archivo?");
  process.exit(1);
}

const listaCompleta = ["/", "/offline.html", "/manifest.json", ...assets];
const nuevaConstante = `const RUTAS_INICIALES = ${JSON.stringify(listaCompleta)};`;
writeFileSync(swPath, sw.replace(rutasRegex, nuevaConstante));

console.log(`service-worker.js: precache de arranque ampliado con ${assets.size} asset(s) de build:`, [...assets]);
