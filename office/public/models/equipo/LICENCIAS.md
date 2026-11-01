# Modelos 3D del equipo · origen y licencia

Estado: **PRUEBA (fase 4.2)**. Antes de usarlos de forma definitiva hay que sustituirlos por una descarga desde la fuente oficial y volver a optimizarlos (ver «Pendiente»).

| Archivo | Personaje original | Autor | Licencia | SHA-256 |
|---|---|---|---|---|
| alex.glb | Suit (Ultimate Modular Men Pack) | Quaternius | CC0 1.0 | 0fe91ca6bf33afa4a5803ddf092ef36a8000b6426476b54e93de1cf995590adb |
| marcus.glb | Casual_2 (Ultimate Modular Men Pack) | Quaternius | CC0 1.0 | 51da8e11ee994e3961aaed8e3c54e1b31708ad31e45f664561aceb15db3f2884 |
| sofia.glb | Women_Casual (Ultimate Modular Women Pack) | Quaternius | CC0 1.0 | d9a998a3396b97cac0154c71ea9fc3d7c89e9f2438925f57651161346f36de3d |

## Licencia

- Fuente oficial: https://quaternius.com/packs/ultimatemodularcharacters.html y https://quaternius.com/packs/ultimatemodularwomen.html (consultadas el 01/11/2026).
- Licencia indicada por el autor: CC0 1.0 Universal (https://creativecommons.org/publicdomain/zero/1.0/), «free to use in personal and commercial projects».
- CC0 permite modificar, usar con fines comerciales y redistribuir dentro de la app sin atribución. Se cita al autor igualmente.

## Procedencia de estos archivos concretos

- La fuente oficial (Google Drive / itch.io) no es accesible desde el entorno de desarrollo. Los archivos se obtuvieron de un repositorio público de GitHub que redistribuye esos mismos personajes CC0:
  - github.com/martian56/ufazien, commit 914171a20cb74bd50b9af504a7be8215569db14f, carpeta frontend/public/avatars/;
  - ese repositorio los procesó con su script build-avatars.mjs: conserva 6 animaciones (Idle, Idle_Neutral, Interact, Run, Walk, Wave) y quita el arma del personaje Suit.
- Después se optimizaron aquí con glTF-Transform 4.5.1:
  - compresión meshopt y cuantización;
  - sin simplificar la malla, sin unir piezas ni materiales y sin texturas.
- Comprobado en cada archivo:
  - GLB 2.0 sin URIs externas ni imágenes;
  - solo las extensiones EXT_meshopt_compression y KHR_mesh_quantization;
  - esqueleto de 62 huesos.
  - (El formato GLB no admite código ejecutable.) Lo verifica tests/staff-models.test.ts.

## Pendiente antes de pasarlos a definitivos

1. Descargar los packs desde quaternius.com o quaternius.itch.io. Para hacerlo desde el entorno: permitir esos dominios en el acceso a red, o subir el .zip.
2. Repetir la optimización (scripts/models/optimizar-equipo.sh) y actualizar los SHA-256 de esta tabla.
