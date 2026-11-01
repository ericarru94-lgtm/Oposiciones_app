"""Genera un trabajador de la oficina con MPFB2 (Blender) y lo exporta a GLB.

Uso (con el módulo bpy de Blender 5.2 y MPFB2 instalado como extensión):
    python generar_personaje.py personajes/alex.json <carpeta_assets_cc0> salida.glb

<carpeta_assets_cc0> es el pack oficial «MakeHuman system assets» (CC0) descomprimido.
Si falta un recurso, el script se detiene: no se sustituye por nada parecido.
"""
import importlib
import json
import os
import sys

import bpy  # noqa: I001 — bpy debe cargarse antes que addon_utils
import addon_utils

spec_path, assets, out = sys.argv[-3:]
spec = json.load(open(spec_path, encoding="utf-8"))
addon_utils.enable("bl_ext.user_default.mpfb", default_set=True, persistent=True)
svc = lambda m, c: getattr(importlib.import_module(f"bl_ext.user_default.mpfb.services.{m}"), c)
HumanService = svc("humanservice", "HumanService")
TargetService = svc("targetservice", "TargetService")

bpy.ops.wm.read_factory_settings(use_empty=True)
macros = TargetService.get_default_macro_info_dict()
macros.update(spec["macros"])
basemesh = HumanService.create_human(macro_detail_dict=macros)
rig = HumanService.add_builtin_rig(basemesh, spec.get("esqueleto", "default"))


def need(rel):
    p = os.path.join(assets, rel)
    if not os.path.isfile(p):
        sys.exit(f"Falta el recurso {rel} en {assets}")
    return p


if assets != "-":
    HumanService.set_character_skin(need(spec["piel"]), basemesh, skin_type="GAMEENGINE")
    for kind, key in (("Eyebrows", "cejas"), ("Eyelashes", "pestanas"), ("Hair", "pelo")):
        HumanService.add_mhclo_asset(need(spec[key]), basemesh, asset_type=kind, subdiv_levels=0)
    for rel in spec["ropa"]:
        HumanService.add_mhclo_asset(need(rel), basemesh, asset_type="Clothes", subdiv_levels=0)

bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_skins=True, export_morph=False,
                          export_animations=False, export_apply=True)
print("GLB", out, os.path.getsize(out), "bytes ·", len(rig.data.bones), "huesos")
