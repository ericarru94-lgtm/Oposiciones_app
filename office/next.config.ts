import type { NextConfig } from "next";

// Aplicación privada y 100 % dinámica (todo depende de la sesión del
// administrador), así que no activamos Cache Components.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

// Retratos del equipo: imágenes estáticas que cambian muy poco. Un día en caché y revalidación en segundo
// plano durante una semana (sin «immutable»: los nombres no llevan versión). Solo los retratos: el proxy de
// sesión los excluye (.webp). Los modelos .glb sí pasan por el proxy y a una visita sin sesión le responde
// con una redirección al acceso, que no debe quedarse en caché.
const assetCache = [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/avatars/equipo/:file*", headers: assetCache },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
