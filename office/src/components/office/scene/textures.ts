"use client";

// Texturas procedurales de la oficina (canvas 2D → textura). Se dibujan una
// vez y se reutilizan: no hay imágenes externas ni descargas. Son decoración
// estática: no representan datos de los agentes.

import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from "three";
import type { ScreenKind } from "@/lib/office/layout";

const cache = new Map<string, CanvasTexture>();

function make(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void) {
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  draw(g, w, h);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  cache.set(key, t);
  return t;
}

const C = {
  bg: "#0b1020",
  panel: "#131a30",
  line: "#22305c",
  cobalt: "#5b7bff",
  cobaltDeep: "#2747f5",
  signal: "#ff4b2b",
  online: "#12b76a",
  warn: "#f5b800",
  paper: "#e8ecf8",
  muted: "#7d88a8",
  violet: "#8b5cf6",
  pink: "#ec4899",
  cyan: "#22d3ee",
};

function frame(g: CanvasRenderingContext2D, w: number, h: number, title: string, accent: string) {
  g.fillStyle = C.bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = C.panel;
  g.fillRect(0, 0, w, 26);
  g.fillStyle = accent;
  g.fillRect(10, 9, 8, 8);
  g.fillStyle = C.paper;
  g.font = "600 13px sans-serif";
  g.fillText(title, 26, 18);
  [w - 46, w - 30, w - 14].forEach((x, i) => {
    g.fillStyle = ["#3a4466", "#3a4466", accent][i];
    g.beginPath();
    g.arc(x, 13, 4, 0, Math.PI * 2);
    g.fill();
  });
}

const bars = (g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, values: number[], color: string) => {
  const bw = w / values.length;
  values.forEach((v, i) => {
    g.fillStyle = color;
    g.globalAlpha = 0.55 + 0.45 * (i / values.length);
    g.fillRect(x + i * bw + 3, y + h - v * h, bw - 6, v * h);
  });
  g.globalAlpha = 1;
};
const lines = (g: CanvasRenderingContext2D, x: number, y: number, w: number, n: number, gap: number, color: string) => {
  for (let i = 0; i < n; i++) {
    g.fillStyle = color;
    g.globalAlpha = 0.35 + ((i * 37) % 50) / 100;
    g.fillRect(x, y + i * gap, w * (0.45 + (((i * 53) % 50) / 100)), 5);
  }
  g.globalAlpha = 1;
};

const SCREENS: Record<ScreenKind, (g: CanvasRenderingContext2D, w: number, h: number) => void> = {
  org: (g, w, h) => {
    frame(g, w, h, "Plan de la misión", C.cobalt);
    const nodes: [number, number][] = [[w / 2, 60], [w / 4, 125], [w / 2, 125], [(3 * w) / 4, 125], [w / 6, 190], [w / 3, 190], [(2 * w) / 3, 190], [(5 * w) / 6, 190]];
    g.strokeStyle = C.line;
    g.lineWidth = 2;
    [[0, 1], [0, 2], [0, 3], [1, 4], [1, 5], [3, 6], [3, 7]].forEach(([a, b]) => {
      g.beginPath();
      g.moveTo(nodes[a][0], nodes[a][1]);
      g.lineTo(nodes[b][0], nodes[b][1]);
      g.stroke();
    });
    nodes.forEach(([x, y], i) => {
      g.fillStyle = i === 0 ? C.signal : i < 4 ? C.cobalt : "#3a4a80";
      g.fillRect(x - 22, y - 11, 44, 22);
    });
  },
  crm: (g, w, h) => {
    frame(g, w, h, "CRM · Embudo", C.signal);
    [0.95, 0.75, 0.55, 0.35, 0.2].forEach((v, i) => {
      g.fillStyle = i === 4 ? C.signal : C.cobalt;
      g.globalAlpha = 0.5 + i * 0.1;
      const bw = (w - 40) * v;
      g.fillRect((w - bw) / 2, 40 + i * 38, bw, 28);
    });
    g.globalAlpha = 1;
  },
  campaign: (g, w, h) => {
    frame(g, w, h, "Campañas", C.warn);
    const cols = [C.warn, C.cobalt, C.online];
    for (let c = 0; c < 3; c++) {
      g.fillStyle = C.panel;
      g.fillRect(12 + c * ((w - 24) / 3), 36, (w - 24) / 3 - 8, h - 48);
      for (let r = 0; r < 4 - c; r++) {
        g.fillStyle = cols[c];
        g.globalAlpha = 0.75;
        g.fillRect(20 + c * ((w - 24) / 3), 46 + r * 40, (w - 24) / 3 - 24, 30);
      }
      g.globalAlpha = 1;
    }
  },
  text: (g, w, h) => {
    frame(g, w, h, "Borrador · Contenidos", C.violet);
    g.fillStyle = C.paper;
    g.fillRect(20, 40, w * 0.55, 10);
    lines(g, 20, 64, w - 40, 9, 18, C.muted);
  },
  design: (g, w, h) => {
    frame(g, w, h, "Diseño · Piezas", C.pink);
    const sw = [C.signal, C.cobaltDeep, C.pink, C.warn, "#0f172a"];
    sw.forEach((c, i) => {
      g.fillStyle = c;
      g.fillRect(16 + i * 34, h - 40, 28, 28);
    });
    g.fillStyle = "#1b2445";
    g.fillRect(16, 38, w - 32, h - 92);
    g.fillStyle = C.pink;
    g.beginPath();
    g.arc(w * 0.38, h * 0.42, 34, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = C.cobalt;
    g.fillRect(w * 0.52, h * 0.3, 70, 50);
  },
  code: (g, w, h) => {
    frame(g, w, h, "flujo · automatización", C.cyan);
    const cols = [C.cyan, C.cobalt, C.online, C.muted, C.warn];
    for (let i = 0; i < 11; i++) {
      g.fillStyle = cols[(i * 3) % cols.length];
      g.globalAlpha = 0.8;
      g.fillRect(16 + ((i * 17) % 4) * 14, 38 + i * 17, 40 + ((i * 41) % 9) * 18, 6);
    }
    g.globalAlpha = 1;
  },
  support: (g, w, h) => {
    frame(g, w, h, "Bandeja de clientes", C.online);
    for (let i = 0; i < 5; i++) {
      g.fillStyle = C.panel;
      g.fillRect(14, 36 + i * 40, w - 28, 32);
      g.fillStyle = i === 0 ? C.online : "#3a4466";
      g.beginPath();
      g.arc(34, 52 + i * 40, 9, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = C.muted;
      g.fillRect(52, 46 + i * 40, (w - 90) * (0.5 + ((i * 29) % 40) / 100), 5);
    }
  },
  finance: (g, w, h) => {
    frame(g, w, h, "Costes y márgenes", C.muted);
    bars(g, 16, 40, w - 32, h - 60, [0.35, 0.5, 0.42, 0.62, 0.55, 0.74, 0.68, 0.86], C.cobalt);
    g.strokeStyle = C.online;
    g.lineWidth = 3;
    g.beginPath();
    [0.6, 0.55, 0.5, 0.42, 0.45, 0.32, 0.3, 0.2].forEach((v, i) => {
      const x = 16 + (i + 0.5) * ((w - 32) / 8);
      const y = 40 + v * (h - 60);
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    });
    g.stroke();
  },
  qa: (g, w, h) => {
    frame(g, w, h, "Revisión · Calidad", C.paper);
    for (let i = 0; i < 6; i++) {
      g.strokeStyle = i < 4 ? C.online : "#3a4466";
      g.lineWidth = 3;
      g.strokeRect(18, 40 + i * 30, 16, 16);
      if (i < 4) {
        g.beginPath();
        g.moveTo(21, 48 + i * 30);
        g.lineTo(26, 53 + i * 30);
        g.lineTo(32, 43 + i * 30);
        g.stroke();
      }
      g.fillStyle = C.muted;
      g.fillRect(46, 45 + i * 30, (w - 80) * (0.5 + ((i * 31) % 40) / 100), 6);
    }
  },
};

export function screenTexture(kind: ScreenKind) {
  return make(`screen-${kind}`, 320, 220, SCREENS[kind]);
}

/** Pantalla en reposo: logotipo de la marca sobre fondo oscuro. */
export function idleScreenTexture() {
  return make("screen-idle", 320, 220, (g, w, h) => {
    g.fillStyle = "#0a0f1e";
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "#2747f5";
    g.lineWidth = 6;
    g.lineCap = "round";
    g.beginPath();
    const s = 2.2, ox = w / 2 - 22 * s, oy = h / 2 - 20 * s;
    [[10, 11, 10, 29], [10, 20, 19, 20], [19, 11, 19, 29], [25, 11, 25, 29], [25, 29, 32, 29], [25, 20, 31, 20], [25, 11, 32, 11]].forEach(([a, b, c, d]) => {
      g.moveTo(ox + a * s, oy + b * s);
      g.lineTo(ox + c * s, oy + d * s);
    });
    g.stroke();
    g.fillStyle = "#ff4b2b";
    g.beginPath();
    g.arc(ox + 32 * s + 10, oy + 29 * s, 6, 0, Math.PI * 2);
    g.fill();
  });
}

export function brandWallTexture() {
  return make("brand-wall", 1024, 256, (g, w, h) => {
    g.fillStyle = "#121829";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#e8ecf8";
    g.font = "600 74px sans-serif";
    g.textAlign = "center";
    g.fillText("HE SIGNAL", w / 2 - 20, 118);
    g.fillStyle = "#ff4b2b";
    g.beginPath();
    g.arc(w / 2 + 210, 100, 12, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#8a91a6";
    g.font = "500 30px sans-serif";
    g.fillText("IA  ·  CHATBOTS  ·  MARKETING", w / 2, 178);
  });
}

/** Ventanal nocturno con la ciudad desenfocada (estático). */
export function windowTexture() {
  return make("window", 512, 256, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#0a1230");
    grad.addColorStop(1, "#1a2350");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) {
      const bw = 18 + ((i * 37) % 40), bh = 60 + ((i * 53) % 140);
      g.fillStyle = "#0d1430";
      g.fillRect((i * 41) % w, h - bh, bw, bh);
      for (let k = 0; k < 6; k++) {
        g.fillStyle = (i + k) % 3 === 0 ? "#f5b80055" : "#5b7bff33";
        g.fillRect(((i * 41) % w) + 4 + (k % 2) * 8, h - bh + 8 + Math.floor(k / 2) * 16, 4, 6);
      }
    }
    g.fillStyle = "#ffffff08";
    for (let x = 0; x < w; x += 128) g.fillRect(x, 0, 4, h);
  });
}

/** Alfombra central con el monograma. */
export function rugTexture() {
  return make("rug", 512, 512, (g, w, h) => {
    g.fillStyle = "#151c33";
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "#2747f5";
    g.lineWidth = 6;
    g.strokeRect(24, 24, w - 48, h - 48);
    g.strokeStyle = "#ff4b2b55";
    g.lineWidth = 2;
    g.strokeRect(40, 40, w - 80, h - 80);
  });
}

/** Suelo de madera oscura en lamas (se repite). */
export function floorTexture() {
  const t = make("floor", 256, 256, (g, w, h) => {
    g.fillStyle = "#2a2f3c";
    g.fillRect(0, 0, w, h);
    for (let r = 0; r < 8; r++) {
      const off = (r % 2) * 64;
      for (let c = -1; c < 3; c++) {
        g.fillStyle = ["#353b4a", "#383e4e", "#323846"][(r + c + 3) % 3];
        g.fillRect(c * 128 + off + 2, r * 32 + 2, 124, 28);
      }
    }
  });
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(6, 5);
  return t;
}
