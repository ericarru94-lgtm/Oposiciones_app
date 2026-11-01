#!/usr/bin/env bash
# Optimiza los GLB del equipo para la web (fase 4.2).
# Uso: scripts/models/optimizar-equipo.sh entrada.glb salida.glb
# Meshopt + cuantización, sin simplificar la malla ni unir piezas o materiales
# (los colores de cada puesto se aplican por nombre de material).
set -euo pipefail
npx --yes @gltf-transform/cli@4.5.1 optimize "$1" "$2" \
  --compress meshopt --simplify false --palette false --join false \
  --instance false --flatten false --texture-compress false
