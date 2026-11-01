# Fase 4.2 · Modelos 3D profesionales (GLB) · prueba con 3 personajes

Fecha: 01/11/2026. El trabajo es solo local, en la rama `ccr-30b91845-834xuv` y **sin commit**. No hay push, ni despliegue, ni cambios en Supabase, la base de datos, el motor, los prompts o los permisos. Producción sigue en `500245f`.

## 1. Modelos investigados

Licencias comprobadas en la página oficial de cada autor el 01/11/2026.

| Candidato | Autor | Licencia | Contenido | Valoración |
|---|---|---|---|---|
| **Ultimate Modular Men Pack** (2022) | Quaternius | **CC0 1.0** | 11 personajes, 24 animaciones, glTF, sin texturas (colores planos), ~6.000 triángulos cada uno | **Seleccionado.** Incluye traje, ropa casual y formal. Estilo coherente |
| **Ultimate Modular Women Pack** (2022) | Quaternius | **CC0 1.0** | 10 personajes, 24 animaciones, glTF, rig humanoide | **Seleccionado** (Sofia) |
| Universal Base Characters (2025) | Quaternius | CC0 1.0 | 6 cuerpos base de ~13.000 triángulos, 20 peinados, rig humanoide | Mejor anatomía, pero solo trae ropa de fantasía: haría falta modelar ropa de oficina |
| Universal Animation Library 1 y 2 (2025–2026) | Quaternius | CC0 1.0 | Más de 120 y más de 130 animaciones, **incluida la de sentado** | Candidata para animaciones en una fase posterior (hay que adaptarlas al esqueleto) |
| Mini / Blocky Characters | Kenney | CC0 | Personajes de bloques | Descartado: aspecto de juguete |
| KayKit Adventurers | Kay Lousberg | CC0 | Personajes de fantasía | Descartado: estilo incompatible con una oficina |
| Personajes y animaciones de Mixamo | Adobe | Licencia propia | — | Descartado por precaución: en una web el GLB queda descargable y no he verificado que sus términos lo permitan |
| Sketchfab y packs de pago | Varios | Varía según el modelo | — | No evaluados a fondo: estilos mezclados, descarga con cuenta y dominio no accesible desde el entorno |

**Mobiliario, para una fase posterior** (no integrado):

- Quaternius Ultimate Furniture y Ultimate Home Interior: CC0, según el sitio del autor.
- Kenney Furniture Kit: CC0.
- Poly Haven: modelos de mobiliario CC0 con texturas PBR.

Hay que verificar cada pack antes de usarlo.

## 2. Origen de los archivos de la prueba

- Desde el entorno de desarrollo no se puede acceder a quaternius.com, itch.io ni Google Drive: la política de red solo deja pasar GitHub y npm.
- Los 3 modelos se tomaron de un repositorio público de GitHub que redistribuye esos mismos personajes CC0 (`martian56/ufazien`, commit `914171a`; lo permite la CC0).
- Comprobado en los archivos:
  - GLB 2.0, sin URIs externas ni imágenes;
  - esqueleto Quaternius de 62 huesos.
- **Antes de dejarlos como definitivos**, hay que bajarlos de la fuente oficial y volver a optimizarlos.

El detalle y las huellas SHA-256 están en `public/models/equipo/LICENCIAS.md`.

## 3. Selección y motivos

| Agente | Modelo base | Ajustes de identidad |
|---|---|---|
| Alex | Suit (traje y corbata) | Traje azul marino, corbata cobalto, camisa blanca |
| Marcus | Casual_2 | Camiseta roja (color de Comercial), pantalón azul marino, zapatos marrones |
| Sofia | Women_Casual | Blusa amarilla (color de Marketing), pantalón oscuro |

- **Piel y pelo**: los mismos colores del avatar de cada agente, que ya estaban en su ficha. No se inventa ningún rasgo nuevo.
- **Motivos**:
  - es el único conjunto CC0 con ropa de oficina, coherente entre hombres y mujeres;
  - esqueleto y animaciones incluidos;
  - ligero;
  - colores planos que encajan con el estilo de la sede.

## 4. Integración técnica

- `src/lib/office/staff-models.ts`: registro de modelos por agente (ruta local, altura, escala y colores).
  - Un agente sin modelo sigue usando la figura generada por código.
  - `?modelos=no` desactiva los modelos: sirve para comparar y como desactivación de emergencia.
- `src/components/office/scene/staff-model.tsx`:
  - carga diferida con `useGLTF` (meshopt), con la figura actual como alternativa mientras carga;
  - copia del esqueleto por puesto; materiales propios, que se liberan al desmontar.
- `src/components/office/scene/staff-pose.ts`: postura calculada apuntando huesos en el espacio del modelo.
  - Sentado: muslos hacia delante y espinillas al suelo.
  - Antebrazos hacia el teclado, mano a la barbilla al pensar, cabeza según el estado.
  - Funciona con cualquier esqueleto humanoide que tenga esos huesos.
- **Animación**: de `Idle_Neutral` solo se usa la respiración del tronco y la cabeza. Tecleo, lectura y pensamiento salen del estado real (`sceneLook`) y solo se mueven si ese estado está animado.
  - Los 6 agentes inactivos no tienen modelo en esta prueba. Si lo tuvieran, el código los deja en gris, con las manos bajadas y sin animación.
- **Silla**: se escala con el modelo (0,85 × escala) para que el asiento encaje con la cadera. Escala del modelo: 1,15 (unos 2,1 m de pie). Así son legibles a la distancia de la cámara sin desproporcionarse frente a la mesa.
- **Optimización**: `scripts/models/optimizar-equipo.sh` (glTF-Transform 4.5.1).
  - Compresión meshopt y cuantización.
  - Sin simplificar la malla y sin unir piezas ni materiales (los colores se aplican por nombre de material).
- **Preparado para más animaciones**:
  - los archivos traen Idle, Idle_Neutral, Interact, Walk, Run y Wave;
  - el mezclador de animaciones ya existe por personaje;
  - una animación de sentado o tecleo (por ejemplo, de la Universal Animation Library) se añadiría como clip filtrado en el mismo sitio.

## 5. Peso de los modelos

| Archivo | Original (GitHub) | Optimizado | Triángulos | Materiales |
|---|---|---|---|---|
| alex.glb | 990 KB | **320 KB** | 6.634 | 8 |
| marcus.glb | 900 KB | **306 KB** | 5.776 | 9 |
| sofia.glb | 957 KB | **313 KB** | 6.424 | 7 |
| **Total** | 2,8 MB | **0,94 MB** | | |

## 6. Rendimiento

Medido con GPU por software (SwiftShader), escritorio 1440×900, en modo desarrollo.

| Métrica | Figuras (fase 4.1) | Modelos GLB (fase 4.2) |
|---|---|---|
| Llamadas de dibujo | 223 | **177** (−21 %) |
| Triángulos | 154.980 | **145.554** (−6 %) |
| Fotograma, calidad alta | 334 ms | 338 ms (+1 %) |
| Fotograma, calidad baja | 220 ms | 224 ms (+2 %) |
| Memoria JS (desarrollo) | 118 MB | 136 MB (+18 MB) |
| Descarga adicional | — | 0,94 MB de GLB, en diferido y solo de la propia app |
| Paquete 3D comprimido | 267 KB | 290 KB (cargador glTF y meshopt) |
| Dibujo en reposo | 0 | 0 |

La escena cuesta lo mismo. El coste alto con GPU por software ya venía de la fase 4.1 (mapa de reflejos y tamaño de la sede), y la calidad automática sigue cubriendo los equipos sin GPU.

## 7. Pruebas

- `tsc`: sin errores.
- Vitest: **180/180**. Incluye 10 nuevas en `tests/staff-models.test.ts`:
  - archivo local sin URIs externas ni imágenes;
  - extensiones permitidas;
  - huesos necesarios;
  - menos de 500 KB;
  - licencia CC0 y SHA-256 registrados en `LICENCIAS.md`;
  - postura sentada y manos en la mesa en las 8 posturas;
  - las inclinaciones no se acumulan.
- Navegador (`scripts/e2e-office.cjs`): **17/17**.
- `next build`: OK.
- Paquete revisado: sin prompts, sin claves y sin `__officeCamera`.
- Sin errores de consola, en calidad alta y baja, en escritorio y en móvil.
- Peticiones de red: solo `localhost` (ningún dominio externo).

## 8. Capturas

Las capturas están en `docs/capturas-fase42/`:

| Archivo | Contenido |
|---|---|
| `00-antes-despues-primeros-planos.png` | Alex, Marcus y Sofia de cerca: figura por código frente a GLB |
| `00-antes-despues-oficina.png`, `00-antes-despues-marcus.png` | Vista cercana y puesto de Marcus |
| `glb-01` a `glb-04` | Vista cercana, Alex, Marcus y Sofia |
| `glb-05` | Calidad baja |
| `glb-06` | Móvil con Sofia |
| `figura-*` | La misma toma con las figuras de la fase 4.1 |

## 9. Valoración honesta

**Mejora clara**:
- proporciones humanas reales;
- manos y brazos bien modelados;
- postura sentada natural, con las manos sobre el teclado;
- peinados y ropa con volumen;
- identidad (piel, pelo, colores del departamento) coherente con la ficha.

Deja de parecer una maqueta de figuras geométricas.

**Límites**:
- Es un estilo *low-poly* de colores planos (Quaternius, 2022): profesional y coherente, pero **no es un acabado premium con texturas**.
- Las caras son sencillas y se ven poco con la cámara isométrica.
- La postura sentada se calcula sobre el esqueleto; no es una animación hecha por un animador.
- Con la vista general, los personajes siguen siendo pequeños.
- Mientras convivan 3 modelos con 6 figuras, se ven dos estilos en la misma oficina.

## 10. Riesgos pendientes

1. **Procedencia**: los archivos vienen de una copia en GitHub. Antes de que sean definitivos hay que bajarlos de quaternius.com o itch.io (permitir esos dominios en el entorno o subir el .zip) y volver a optimizarlos.
2. **Dos estilos** mientras no se sustituyan los 9.
3. **Memoria**: +18 MB, por las copias de los esqueletos.
4. Los nombres de material del autor no describen la pieza (por ejemplo, `LightBrown` es la camisa de Marcus). Está documentado en el registro.

## 11. Recomendación

**Sí merece la pena sustituir los 9**, con estos packs CC0, si el nivel *low-poly* de colores planos te parece suficiente:

- hay 21 conjuntos de ropa (11 hombres y 10 mujeres), suficientes para 9 personajes distintos;
- el coste de rendimiento es nulo;
- desaparece la mezcla de estilos.

Pasos:

1. Descargar los dos packs oficiales.
2. Asignar los modelos de los otros 6 agentes (por ejemplo, traje para Oscar y Victoria, formal para Emma, sudadera para David, casual para Daniel y Lucia).
3. Pasarlos por el mismo script de optimización y por las mismas pruebas.

Si buscas un acabado **premium con texturas y caras detalladas**, este pack no llega. Las alternativas son:

- encargar un set de 9 personajes estilizados a un artista 3D;
- o comprar un pack comercial, verificando antes que su licencia permite distribuirlo dentro de una web.

Ambas requieren presupuesto y tu decisión.
