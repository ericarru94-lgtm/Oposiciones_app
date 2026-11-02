"""Recolorea la textura de una prenda del pack «MakeHuman system assets» (CC0) por zonas.

Fase 4.4. El pack solo trae 2 trajes formales y casi ningún pantalón femenino de vestir, así que para
vestir a 9 personas distintas se recolorean prendas existentes. La malla no cambia; solo la textura.

Cómo funciona:
  1. Lee la malla de la prenda (.obj) y separa sus piezas de patrón (islas UV) en «arriba» y «abajo»
     según la altura media de cada pieza respecto a `corte_y` (unidades del .obj).
  2. En cada zona aplica un color conservando la luminancia relativa: arrugas, costuras y pespuntes
     se mantienen. Opcionalmente solo a los píxeles de un rango de luminancia (p. ej. la tela oscura de
     un traje, sin tocar la camisa blanca).
  3. Si se pide, borra logotipos: los píxeles con un matiz muy distinto del dominante de la zona pasan a
     la luminancia media de la zona.

Uso (Python 3 con numpy y Pillow; no necesita Blender):
    python recolorear_ropa.py ficha.json <carpeta_pack> <carpeta_salida>
Lee `postproceso.ropa` de la ficha y escribe <carpeta_salida>/<prenda>_diffuse.png.
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw


def hex_rgb(h):
    return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], dtype=np.float32) / 255.0


def load_obj(path):
    vs, vts, faces = [], [], []
    for line in open(path, encoding="utf-8", errors="ignore"):
        p = line.split()
        if not p:
            continue
        if p[0] == "v":
            vs.append([float(x) for x in p[1:4]])
        elif p[0] == "vt":
            vts.append([float(x) for x in p[1:3]])
        elif p[0] == "f":
            idx = [tuple(int(t) - 1 if t else -1 for t in (c.split("/") + ["", ""])[:2]) for c in p[1:]]
            faces.append(idx)
    return np.array(vs), np.array(vts), faces


def zone_masks(obj_path, size, cut_y):
    """Máscaras «arriba» y «abajo» por islas UV completas.

    Cada pieza del patrón (isla UV: caras unidas por coordenadas UV compartidas) se asigna entera según la
    altura media de sus vértices respecto a `cut_y`. Así el bajo de una camiseta y la cinturilla de un
    pantalón, que están a la misma altura, no se mezclan.
    """
    vs, vts, faces = load_obj(obj_path)
    parent = list(range(len(vts)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for f in faces:
        ts = [t for _, t in f if t >= 0]
        for t in ts[1:]:
            ra, rb = find(ts[0]), find(t)
            if ra != rb:
                parent[ra] = rb
    island_y = {}
    for f in faces:
        ts = [t for _, t in f if t >= 0]
        if not ts:
            continue
        r = find(ts[0])
        acc = island_y.setdefault(r, [0.0, 0])
        for v, _ in f:
            acc[0] += vs[v][1]
            acc[1] += 1
    masks = {"arriba": Image.new("L", size, 0), "abajo": Image.new("L", size, 0)}
    draws = {k: ImageDraw.Draw(m) for k, m in masks.items()}
    w, h = size
    for f in faces:
        ts = [t for _, t in f if t >= 0]
        if len(ts) < 3:
            continue
        s_, n = island_y[find(ts[0])]
        zone = "arriba" if s_ / n >= cut_y else "abajo"
        draws[zone].polygon([(vts[t][0] * w, (1 - vts[t][1]) * h) for t in ts], fill=255)
    # Un poco de margen para cubrir los bordes de las islas UV (evita costuras sin teñir).
    from PIL import ImageFilter
    return {k: np.array(m.filter(ImageFilter.MaxFilter(5))) > 0 for k, m in masks.items()}


def rgb_to_hue(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx, mn = rgb.max(-1), rgb.min(-1)
    d = mx - mn + 1e-6
    h = np.where(mx == r, (g - b) / d % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    return h, (mx - mn) / (mx + 1e-6)


def recolor(img, mask, color, lum_range=None, quitar_logos=False, contraste=1.0):
    rgb = img[..., :3]
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    sel = mask.copy()
    if lum_range:
        sel &= (lum >= lum_range[0]) & (lum <= lum_range[1])
    if not sel.any():
        return 0
    if quitar_logos:
        hue, sat = rgb_to_hue(rgb)
        base = np.median(hue[sel & (sat > 0.15)]) if (sel & (sat > 0.15)).any() else 0
        dist = np.minimum(abs(hue - base), 360 - abs(hue - base))
        logo = sel & (sat > 0.25) & (dist > 35)
        # También los logotipos claros sobre tela oscura (o al revés): luminancia muy alejada de la zona.
        med = np.median(lum[sel])
        logo |= sel & (abs(lum - med) > 0.18)
        # Se ensancha la máscara unos píxeles para no dejar el contorno del logotipo.
        from PIL import ImageFilter
        logo = np.array(Image.fromarray((logo * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(9))) > 0
        logo &= sel
        lum = np.where(logo, med, lum)
    ref = np.median(lum[sel])
    target = hex_rgb(color)
    # `contraste` < 1 suaviza estampados muy marcados (p. ej. rayas) sin perder arrugas ni costuras.
    scale = np.clip(1 + (lum / max(ref, 1e-3) - 1) * contraste, 0, 2.2)[..., None]
    out = np.clip(target[None, None, :] * scale, 0, 1)
    rgb[sel] = out[sel]
    return int(sel.sum())


def main():
    spec_path, pack, out_dir = sys.argv[1:4]
    spec = json.load(open(spec_path, encoding="utf-8"))
    os.makedirs(out_dir, exist_ok=True)
    for prenda, cfg in spec.get("postproceso", {}).get("ropa", {}).items():
        base = os.path.join(pack, "clothes", prenda, prenda)
        src = Image.open(base + "_diffuse.png")
        mode = src.mode
        img = np.asarray(src.convert("RGBA"), dtype=np.float32) / 255.0
        masks = zone_masks(base + ".obj", src.size, cfg.get("corte_y", 0.6))
        for zona in cfg["zonas"]:
            mask = masks["arriba"] | masks["abajo"] if zona["zona"] == "todo" else masks[zona["zona"]]
            n = recolor(img, mask, zona["color"], zona.get("luminancia"), zona.get("quitar_logos", False), zona.get("contraste", 1.0))
            print(f"{prenda}: {zona['zona']} → {zona['color']} ({n} píxeles)")
        out = Image.fromarray((img * 255 + 0.5).astype(np.uint8), "RGBA")
        if mode != "RGBA":
            out = out.convert("RGB")
        out.save(os.path.join(out_dir, f"{prenda}_diffuse.png"))


if __name__ == "__main__":
    main()
