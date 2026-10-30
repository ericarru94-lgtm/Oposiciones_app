import type { NextConfig } from "next";

// Aplicación privada y 100 % dinámica (todo depende de la sesión del
// administrador), así que no activamos Cache Components.
const nextConfig: NextConfig = {
  poweredByHeader: false,
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
