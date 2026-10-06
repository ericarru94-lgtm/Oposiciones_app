# Plantilla de contenido HE Signal

Colores: naranja #FF4B2B (oscuro #E23B1C), fondo #10151F. Tipografías: Space Grotesk (títulos) e Inter (texto).

Requisitos: Chromium de Playwright, ffmpeg y las fuentes instaladas en `~/.fonts`:
```bash
mkdir -p ~/.fonts && cd ~/.fonts
curl -sSfL -o spacegrotesk.ttf "https://raw.githubusercontent.com/google/fonts/main/ofl/spacegrotesk/SpaceGrotesk%5Bwght%5D.ttf"
curl -sSfL -o inter.ttf "https://raw.githubusercontent.com/google/fonts/main/ofl/inter/Inter%5Bopsz,wght%5D.ttf"
fc-cache -f
```

- **Reels (1080x1920, MP4 + portada):** `node render.js reel1.json salida.mp4`. Cada JSON define duración, segundo de portada y elementos (`text` con clase `big`/`mid`/`step`/`small`/`tag`, `phone` y mensajes `in`/`out`/`typing`) con su momento de entrada (`at`) y salida (`until`).
- **Carruseles (1080x1350, PNG):** edita el array `slides` de `carrusel.js` y ejecuta `node carrusel.js`.
