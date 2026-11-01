# Fase 4.3 · Personajes realistas con recursos gratuitos · estado del piloto (Alex)

Fecha: 01/11/2026. Todo el trabajo es local, sin commit, push ni despliegue. No se ha tocado el motor, los prompts, los modelos de IA, los permisos, los presupuestos, Supabase, la base de datos, las migraciones, las variables ni las misiones. Coste: **0 €**.

## Resumen

- **Herramienta elegida: MPFB2** (MakeHuman Plugin for Blender) con **Blender 5.2 LTS**. Es la única opción gratuita con anatomía realista y una licencia limpia para una web comercial.
- **La cadena técnica funciona en el entorno**: Blender en modo sin pantalla, MPFB2, el cuerpo de Alex con sus parámetros y esqueleto completo, y la exportación a GLB.
- **El piloto visual de Alex está bloqueado**:
  - el traje, el pelo, la piel con textura, las cejas y las pestañas están en el pack oficial «MakeHuman system assets» (CC0);
  - ese pack solo se descarga desde `files.makehumancommunity.org`;
  - la política de red del entorno bloquea ese dominio (solo deja GitHub, npm y PyPI).
- **No se ha integrado nada en la oficina** ni se han hecho capturas de Alex: un cuerpo sin ropa, pelo ni piel no sirve como piloto, y no se ha sustituido por nada parecido.

## 1. Comparativa de herramientas

| Herramienta | Calidad anatómica | Rostro, pelo y ropa | Esqueleto | GLB | Licencia | Veredicto |
|---|---|---|---|---|---|---|
| **MPFB2** (makehumancommunity/mpfb2) | Alta: malla MakeHuman de ~13.000 vértices de cuerpo, cientos de controles de forma | Pack oficial CC0: 21 pieles con textura, ojos, 12 cejas, 4 pestañas, 9 peinados, trajes (`male_elegantsuit01`, `female_elegantsuit01`), ropa casual y 6 zapatos | 163 huesos (cara y dedos); también Rigify | Sí (exportador glTF de Blender) | Código **GPL-3** (solo se usa como herramienta, no va en la app). Recursos **CC0** (`LICENSE.ASSETS.md`) | **Elegida** |
| MakeHuman 1.x / 2 (alpha) | La misma malla | Los mismos packs | Sí | Mediante Blender | Lo exportado es CC0 (según la propia documentación de MakeHuman). MakeHuman 2 sigue en alpha | MPFB2 es la vía actual |
| Blender 5.2.3 LTS | — | — | — | Sí | GPL. Lo que se crea con él es del autor | Se usa como motor (paquete oficial `bpy` de PyPI) |
| MB-Lab (animate1978) | Alta | Pieles con textura incluidas | Sí | Sí | Los modelos generados son **AGPL-3**. Su mantenedor indica que **no se pueden usar en trabajos comerciales** (issue #292). Sin actualizaciones desde 2021 | **Descartada** |
| CharMorph | Alta | Variable | Sí | Sí | Deriva de MB-Lab: la licencia de sus modelos base no está verificada | No evaluada a fondo |

## 2. Licencias verificadas

- **MPFB2**, commit `6ff1eb3` (24/10/2026):
  - `LICENSE.CODE.md`: GPL-3;
  - `LICENSE.ASSETS.md`: CC0 1.0. Incluye la malla base, los controles de forma, los esqueletos y los ojos del repositorio.
- **Pack «MakeHuman system assets»**, consultado en https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html:
  - la tabla oficial indica, recurso por recurso, autor `makehuman_system` y licencia **CC0**;
  - entre ellos: `male_elegantsuit01`, `shoes01` a `shoes06`, `short01` a `short04`, `eyebrow001` a `eyebrow012`, `eyelashes01` a `eyelashes04` y las pieles `young/middleage/old_*_male/female`.
- **Blender**: paquete oficial `bpy` 5.2.3 de PyPI.
- **Packs comunitarios** («Hair 02», «Skins 01/02»…): no se usan hasta comprobar la licencia de cada recurso.

## 3. Lo que ya funciona

Probado en el entorno el 01/11/2026:

1. `bpy` 5.2.3 LTS instalado aparte (no forma parte del proyecto).
2. MPFB2 instalado como extensión de Blender desde el repositorio oficial de GitHub.
3. `office/scripts/models/mpfb/generar_personaje.py` + `personajes/alex.json`:
   - cuerpo con sus parámetros: sexo, edad (~40 años), musculatura, peso, altura y proporciones;
   - esqueleto `default` de 163 huesos;
   - exportación a GLB.
4. Resultado del cuerpo sin ropa: **26.756 triángulos, 163 huesos, 945 KB** antes de optimizar.
5. Cuando haya recursos, el script aplica piel (`GAMEENGINE`, material compatible con glTF), ojos, cejas, pestañas, pelo, traje y zapatos. Si falta uno, se detiene (no lo sustituye).

## 4. Diseño del piloto (Alex)

- **Cuerpo**: adulto de ~40 años, complexión media-atlética, algo más alto que la media.
- **Piel**: textura realista del pack CC0, con el tono más cercano al de su avatar actual (`#C68A62`).
- **Ropa**: traje formal `male_elegantsuit01` (chaqueta, camisa y corbata) y zapatos de vestir. Colores de la marca: azul marino y corbata cobalto.
- **Pelo**: `short02` (corto, peinado), cejas `eyebrow001`, pestañas `eyelashes01`, ojos marrones.
- **Postura**: sentado en el despacho, con la misma lógica de postura por huesos de la fase 4.2, adaptada al esqueleto MakeHuman.

## 5. Arquitectura para los nueve

- **Una ficha JSON por trabajador** (`scripts/models/mpfb/personajes/*.json`): parámetros físicos, piel, pelo, ropa y esqueleto.
  - Mismo generador para los 9, así que escala, proporciones y calidad son coherentes.
  - Las caras se diferencian con los controles de forma de la cara; la ropa y el pelo, con los recursos del pack.
- **Optimización** (se medirá con los modelos reales, no se supone):
  - texturas a 1024 px y KTX2;
  - meshopt;
  - pelo y ropa con `subdiv 0`;
  - una versión ligera para la vista general, si la medición lo justifica (los «proxies» de MakeHuman).
- **En la app**:
  - el mismo componente de la fase 4.2 (`StaffModel`): carga diferida, alternativa mientras carga y `?modelos=no`;
  - una postura por huesos para el esqueleto MakeHuman, que depende solo del estado real;
  - los 6 inactivos, sin animación de trabajo.

## 6. Rendimiento

Todavía no hay mediciones del personaje vestido.

- Estimación a comprobar: entre 40.000 y 60.000 triángulos y 2–4 MB por trabajador con texturas.
- Es entre 6 y 10 veces más que Quaternius (6.600 triángulos y 320 KB).
- Las cifras reales se medirán con el piloto. No se dará por bueno el rendimiento en GPU real sin una prueba en un equipo físico.

## 7. Limitaciones y riesgos

1. **Bloqueo de red** (impide avanzar): hace falta `files.makehumancommunity.org`.
2. **Coste de render**: los personajes realistas pesan bastante más. Para los 9 habrá que medir y, quizá, usar versiones ligeras a distancia.
3. **Pelo**: en MakeHuman son tarjetas con transparencia. Se ve bien de cerca, pero en WebGL hay que ajustar la transparencia para evitar artefactos.
4. **Rostros**: realistas pero algo genéricos. La diferencia entre trabajadores depende de ajustar bien los controles de forma.
5. **Expresiones y animación facial**: el esqueleto las permite, pero quedan para otra fase.

## 8. Recomendación

**Seguir con MPFB2.** Es la única opción gratuita que cumple a la vez la calidad realista y la licencia comercial limpia (CC0), y la cadena técnica ya está probada.

Para terminar el piloto de Alex, falta solo el pack oficial de recursos. Hay dos formas:

- **A (recomendada)**: permitir `files.makehumancommunity.org` (y `static.makehumancommunity.org`) en el acceso a red del entorno. Ajustes del entorno → Network access → Allowed domains: https://code.claude.com/docs/en/cloud-environments#network-access
- **B**: subir el archivo `makehuman_system_assets_cc0.zip` (unos 267 MB), descargado desde https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html

Con el pack, el siguiente paso será:

1. generar a Alex;
2. hacer las 5 vistas (frontal, lateral, cuerpo completo, sentado y desde la cámara de la oficina) y la comparación con Quaternius;
3. medir el rendimiento;
4. decidir si se hacen los otros 8.
