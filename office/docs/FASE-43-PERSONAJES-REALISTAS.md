# Fase 4.3 · Personajes realistas con recursos gratuitos · estado del piloto (Alex)

Fecha: 01/11/2026. Todo el trabajo es local, sin commit, push ni despliegue. No se ha tocado el motor, los prompts, los modelos de IA, los permisos, los presupuestos, Supabase, la base de datos, las migraciones, las variables ni las misiones. Coste: **0 €**.

## Resumen (actualizado el 02/11/2026)

- **Piloto de Alex terminado** con MPFB2 + Blender 5.2 + el pack oficial «MakeHuman system assets» (CC0). Ya no hay bloqueo: el dominio se permitió el 02/11.
- **Resultado:**
  - persona adulta con anatomía real, cara creíble, ojos y pestañas;
  - pelo con volumen;
  - traje formal con solapas, botones, bolsillos, camisa y corbata;
  - zapatos de vestir y manos con dedos.
  - **Claramente superior a Quaternius** (ver capturas).
- **Integrado en su despacho**, sentado. Su postura depende solo del estado real.
  - Marcus y Sofia siguen con Quaternius y los otros 6, con la figura geométrica, hasta que se decida producirlos.
  - `?modelos=quaternius` y `?modelos=no` permiten comparar o volver atrás.
- **Coste:** 0 €.

### Medidas del piloto

| | Figura (4.1) | Quaternius (4.2) | **Alex realista (4.3)** |
|---|---|---|---|
| Peso GLB | — (código) | 320 KB | **2,0 MB** (texturas WebP ~570 KB) |
| Triángulos del personaje | ~2.500 | 6.634 | **39.700** |
| Piezas / materiales | ~40 / planos | 4 / 8 colores | **7 / 7** (piel, ojos, cejas, pestañas, pelo, traje, zapatos) |
| Texturas | 0 | 0 | **8** (1024 px) |
| Esqueleto | — | 62 huesos | **163 huesos** (cara y dedos) |

**Escena completa** (Alex realista, Marcus y Sofia con Quaternius y 6 figuras), medida con GPU por software (SwiftShader):

- Llamadas de dibujo: 177 con Quaternius → **174**.
- Triángulos: 145.500 → **178.600**.
- Fotograma, calidad alta: entre +5 % y +15 % (668–728 ms frente a 639–684 ms; el ruido de la medida es de ±10 %).
- Fotograma, calidad baja: igual (408 ms frente a 400 ms).
- Carga: entre 1 y 4 s más en modo desarrollo.
- No se ha medido en una GPU real: hace falta probarlo en un equipo físico.

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

## 3. Proceso (reproducible)

Probado en el entorno el 01/11/2026:

1. `bpy` 5.2.3 LTS instalado aparte (no forma parte del proyecto).
2. MPFB2 instalado como extensión de Blender desde el repositorio oficial de GitHub.
3. `office/scripts/models/mpfb/generar_personaje.py` + `personajes/alex.json`:
   - cuerpo con sus parámetros: sexo, edad (~40 años), musculatura, peso, altura y proporciones;
   - esqueleto `default` de 163 huesos;
   - exportación a GLB.
4. Resultado del cuerpo sin ropa: **26.756 triángulos, 163 huesos, 945 KB** antes de optimizar.
5. Con el pack, el script aplica piel, ojos, cejas, pestañas, pelo, traje y zapatos con materiales `GAMEENGINE` (compatibles con glTF). Si falta un recurso, se detiene.
6. `postproceso.mjs` (glTF-Transform):
   - transparencia correcta por pieza; sin esto la cara tenía manchas y los ojos se veían blancos;
   - ojos `brownlight` (el `brown` del pack es rojizo);
   - tono de piel del avatar mediante un factor de color;
   - texturas a 1024 px en WebP: de 13 MB a 2,0 MB.
7. Meshopt **descartado** para estos modelos: su cuantización creaba un esqueleto por pieza (7 en vez de 1). KTX2 no se ha probado (necesita la herramienta `toktx`, no disponible); WebP da un peso razonable.

Problemas resueltos durante el piloto:
- las zapatillas `shoes02` se cambiaron por los zapatos de vestir `shoes04`;
- manchas en la cara y pelo fino, por la transparencia mal ordenada;
- ojos blancos, por la capa de la córnea;
- piel demasiado clara frente al avatar.

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

## 6. Rendimiento con los 9 (estimación a partir del piloto)

- Unos 357.000 triángulos de personajes y unos 18 MB de GLB, que se cargan en diferido.
- Las texturas de traje, pelo, cejas y ojos se pueden compartir entre personajes, lo que bajaría el peso.
- Con 9 personajes realistas, la escena en GPU por software iría claramente más lenta.
- Propuestas antes de producir los 9:
  1. una versión ligera para la vista general (proxy de MakeHuman de ~1.600 vértices), con el modelo completo solo al acercarse;
  2. probar en un equipo real con GPU integrada.

## 7. Limitaciones y riesgos

1. **Red**: resuelto (dominio permitido el 02/11/2026).
2. **Coste de render**: los personajes realistas pesan bastante más. Para los 9 habrá que medir y, quizá, usar versiones ligeras a distancia.
3. **Pelo**: en MakeHuman son tarjetas con transparencia. Se ve bien de cerca, pero en WebGL hay que ajustar la transparencia para evitar artefactos.
4. **Rostros**: realistas pero algo genéricos. La diferencia entre trabajadores depende de ajustar bien los controles de forma.
5. **Expresiones y animación facial**: el esqueleto las permite, pero quedan para otra fase.

## 8. Recomendación

**Continuar con MPFB2 para los otros 8.** La calidad es claramente superior a Quaternius, la licencia es CC0, el proceso es reproducible y el coste es 0 €.

Antes de producirlos conviene:

1. Aprobar el aspecto de Alex: cara, traje y pelo. Se puede afinar: traje azul marino, otros peinados y rasgos de la cara.
2. Decidir el vestuario de cada uno. El pack tiene 2 trajes formales (hombre y mujer), 7 conjuntos casuales, 1 de trabajo, 6 zapatos, 10 peinados y 21 pieles.
   - Para más variedad de ropa habrá que añadir recursos comunitarios, verificando la licencia de cada uno.
3. Aceptar el coste de rendimiento o pedir antes la versión ligera para la vista general.

## Capturas

`docs/capturas-fase43/`:

- `00-comparacion-tres-versiones.png`: figura, Quaternius y realista en la misma toma;
- `01-frontal.png`, `02-lateral.png`, `03-cuerpo-completo.png`, `03b-tres-cuartos.png`;
- `04-sentado-escritorio.png`;
- `05-camara-oficina.png`: cámara isométrica real, con su ficha.
