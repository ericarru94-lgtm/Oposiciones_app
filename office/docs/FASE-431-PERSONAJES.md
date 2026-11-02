# Fase 4.3.1 · Personajes realistas, identidad visual y niveles de detalle

Fecha: 02/11/2026. Todo el trabajo es local: sin commit, push ni despliegue. Coste: **0 €**.

No se ha tocado: motor, Alex como orquestador, agentes, prompts, herramientas, permisos, aprobaciones, presupuestos, Supabase, migraciones, RLS, autenticación, variables, n8n, CRM ni misiones.

## 1. Fichas de identidad de los nueve

Rasgos neutros de adulto, sin estereotipos. La diferencia está en la complexión, la cara, el peinado, la ropa y el color del departamento, que también se ve desde la vista general (zona y tótem).

| Agente | Complexión y cara | Peinado | Vestuario (recursos CC0 del pack) | Color | Accesorios | Postura característica | Reconocible desde lejos por |
|---|---|---|---|---|---|---|---|
| **Alex** · CEO (hecho) | ~40 años, media-atlética, alto; cara de rasgos regulares | `short02`, corto peinado, castaño | Traje formal `male_elegantsuit01`, camisa y corbata; zapatos de vestir `shoes04` | Azul de dirección | — | Erguido, manos sobre la mesa | Traje oscuro, despacho acristalado |
| **Marcus** · Comercial (hecho) | ~30 años, más corpulento y ancho de hombros; cabeza cuadrada, mandíbula marcada | `short01`, muy corto, negro | Smart casual: camisa azul y vaqueros `male_casualsuit01`; zapatos de piel marrones `shoes01` | Rojo de Comercial (zona) y camisa azul | — | Inclinado hacia la pantalla al trabajar | Camisa azul clara, zona roja |
| **Sofia** · Marketing (hecha) | ~30 años, esbelta; cara ovalada, mentón fino | `long01`, largo castaño | Elegante: blusa de rayas y falda `female_elegantsuit01`; botines `shoes03` | Amarillo de Marketing (zona) y blusa granate | — | Erguida, manos sobre el teclado | Pelo largo y blusa de rayas |
| Daniel · Contenidos | ~35 años, delgado; cara alargada | `short03`, desenfadado | Camisa de cuadros con vaqueros (`male_casualsuit03`) | Morado | Gafas (cuando haya un recurso CC0 verificado) | Ligeramente echado hacia atrás, leyendo | Camisa de cuadros |
| Lucia · Creatividad | ~28 años, media; cara redondeada | `bob01`, media melena | Conjunto casual (`female_casualsuit01`), recoloreado sin el logotipo del pack | Rosa | — | Mano cerca de la tableta | Melena corta oscura |
| David · Automatización | ~33 años, alto y delgado | `short04` | Chaqueta acolchada sobre camiseta (`male_casualsuit05`) | Cian | — | Inclinado hacia el monitor doble | Chaqueta verde grisácea |
| Emma · Atención al cliente | ~30 años, media; cara amable de rasgos suaves | `ponytail01`, coleta pelirroja | Conjunto casual sobrio (`female_casualsuit02` o elegante recoloreado) | Verde | Cascos con micrófono (pendiente de recurso CC0) | Erguida, de cara al monitor | Coleta |
| Oscar · Finanzas | ~45 años, robusto; cara ancha | `short02` en gris | Traje sobrio (`male_elegantsuit01` en otro color) | Gris pizarra | — | Erguido, muy quieto | Traje gris y pelo canoso |
| Victoria · Calidad | ~38 años, esbelta; cara angulosa | `bob02` o `braid01` | Conjunto elegante (`female_elegantsuit01` en otro color) | Azul marino | — | Erguida, revisando | Trenza o melena clara |

Notas:

- El pack solo tiene **2 trajes formales** (hombre y mujer), 7 conjuntos casuales, 1 de trabajo, 6 zapatos, 10 peinados y 21 pieles.
  - Para que los 9 no compartan prenda hay que recolorear las texturas (proceso documentado, sin cambiar la malla) o añadir recursos comunitarios con licencia verificada.
  - Las gafas y los cascos no están en el pack del sistema.
- **Discrepancia sobre Alex**: la petición de esta fase habla de «traje azul marino», pero el modelo aprobado en la fase 4.3 lleva el traje gris antracita del pack. Como Alex no se debía modificar, se ha dejado tal cual. Si se quiere azul marino, es un cambio de color de la textura del traje (unos minutos), pero hay que aprobarlo.

### Estrategia para que los nueve no parezcan clones

Revisado en la fase 4.3.2.

1. **Silueta distinta:**
   - parámetros físicos propios: edad (28–45 años), musculatura, peso, altura y proporciones;
   - mezcla de complexiones: esbelta, media, corpulenta y robusta.
2. **Cara distinta:** cada ficha combina controles de forma de la cabeza, mentón, nariz y boca, y ninguna repite la misma combinación. Se compara con un retrato de los nueve juntos antes de aprobar.
3. **Peinado único:** hay 10 peinados en el pack y ningún personaje repite. Si dos necesitaran el mismo, se cambia el color con un factor (documentado).
4. **Ropa:**
   - el pack solo tiene 2 trajes formales, así que Oscar y Victoria usarán los trajes recoloreados (otra textura de color, la misma malla);
   - los demás llevan conjuntos casuales distintos;
   - ninguna prenda se repite con el mismo color.
5. **Color del departamento**: visible en la zona, en el tótem y en un acento de la ropa cuando el recurso lo permita.
6. **Pieles**: textura del pack con el tono del avatar de cada uno (factor de color), sin repetir combinación de piel, pelo y ojos.
7. **Comprobación automática** al producirlos: la prueba de retratos exige un retrato por agente con modelo, y se revisarán a mano los nueve retratos juntos.

## 2. Resultados

| | Alex (sin cambios) | Marcus | Sofia |
|---|---|---|---|
| Triángulos LOD0 / LOD1 / LOD2 | 39.700 / 20.884 / 4.758 | 41.770 / 22.558 / 5.006 | 32.246 / 17.450 / 3.866 |
| Peso LOD0 / LOD1 / LOD2 | 2,01 / 1,00 / 0,30 MB | 2,46 / 1,19 / 0,35 MB | 1,73 / 0,96 / 0,29 MB |
| Huesos | 163 (cara y dedos) | 163 | 163 |
| Texturas | 8 WebP (1024 px en LOD0) | 8 | 8 |
| Esqueletos por modelo | 1 | 1 | 1 |

- **Herramientas**: Blender 5.2.3 LTS (`bpy`), MPFB2 (commit 6ff1eb3) y glTF-Transform 4.5 con meshoptimizer y sharp. Todas gratuitas y libres.
- **Proceso reproducible** en `scripts/models/mpfb/`:
  - `generar_personaje.py` con una ficha JSON por personaje;
  - `postproceso.mjs`;
  - `niveles-detalle.mjs`.
- **Compatibilidad de esqueletos**: `RIG_BONES` tiene una correspondencia para Quaternius y otra para MakeHuman. Los modelos Quaternius siguen funcionando con `?modelos=quaternius`.
- **Posturas**, medidas en la escena con el LOD0:
  - muñecas a la altura del tablero (0,79 m), 8–14 cm dentro del borde, delante del teclado;
  - rodillas a 0,58 m, por debajo del tablero (0,73 m);
  - cabeza a 1,32–1,38 m, mirando al frente (unos 25° por encima de la horizontal, como en reposo).
  - No atraviesan la mesa ni la silla.
- **Estados**: la postura depende solo de `sceneLook` (estado real).
  - Las pruebas recorren las 8 posturas en los 9 archivos.
  - Los 6 inactivos siguen con la figura geométrica gris, sin animación. Lo comprueba el navegador: 0 dibujos en reposo.

### Límites encontrados (sin ocultar)

1. **Caras poco visibles desde la cámara de la oficina**: la cámara isométrica mira desde arriba y los monitores tapan la cara de frente. Las caras se ven bien en las vistas cercanas y en la ficha.
2. **Piel de Sofia muy clara**: la textura del pack se ve casi blanca con la luz de la oficina. Se compensó con un tono algo más oscuro que su avatar; está documentado.
3. **Pelo `long01`**: la parte de arriba tiene una franja más clara (la base del cuero cabelludo en la textura).
4. **Sofia lleva falda**: el pack no tiene pantalón de vestir femenino.
5. **Factor de tono**: un factor de color solo puede oscurecer la textura. Si el tono buscado es más claro, solo se ajusta el matiz.

## 3. Niveles de detalle (LOD)

- **Criterio**: la altura del trabajador en pantalla, en píxeles. Con la cámara ortográfica es `zoom × altura sentado`.
  - LOD0 a partir de 180 px; LOD1 entre 70 y 180 px; LOD2 por debajo de 70 px.
  - Histéresis del 15 % para que no oscile cerca de un umbral.
- **Cuándo cambia**:
  - vista general y vista cercana inicial (~45–60 px): LOD2;
  - foco en un puesto (~120 px): LOD1;
  - acercando más con la rueda o el pellizco: LOD0.
  - Los trabajadores fuera de la cámara se quedan en LOD2 aunque el zoom sea alto.
  - En móvil el tope es LOD1.
- **Sin saltos**: el nivel nuevo se descarga en segundo plano y solo sustituye al anterior cuando está listo; no hay huecos ni figura de reserva.
  - Diferencia medida en la misma toma (foco en Marcus): LOD0 frente a LOD1, 0,02 de media sobre 255 y 0 % de píxeles con diferencia apreciable.
- **Memoria**:
  - cada puesto clona solo el esqueleto; geometría y texturas se comparten desde la caché;
  - al salir de la vista 3D, `releaseStaffModels()` libera geometrías, materiales y texturas, también en la GPU;
  - comprobado: al volver a 3D se descargan de nuevo.
- **Técnicas evaluadas**:
  - Meshopt: descartado, porque duplica el esqueleto por pieza.
  - KTX2: no probado (requiere `toktx`, que no está disponible); se usa WebP.
  - Instancing: no es posible con personajes animados distintos.
  - Texturas compartidas entre personajes: posible con los 9 cuando repitan prendas.

## 4. Rendimiento

**Medido con GPU por software (SwiftShader) en el navegador, en modo desarrollo. No hay medidas en hardware físico.** Ver `docs/capturas-fase431/` y la tabla:

| Escena (escritorio 1440×900) | Vista cercana | Vista general | Foco en un puesto |
|---|---|---|---|
| Figuras por código | 564 ms · 223 llamadas · 155.000 triángulos | 450 ms · 237 · 157.400 | 437 ms · 110 · 116.900 |
| Quaternius (fase 4.2) | 559 ms · 177 · 145.600 | 453 ms · 191 · 148.000 | 475 ms · 114 · 126.700 |
| **3 realistas con LOD** | 565–588 ms · 169 · 140.400 | 436–491 ms · 183 · 142.800 | 469–508 ms · 106 · **152.600** |
| 9 realistas (prueba técnica `?prueba9=1`) | 645–658 ms · 211 · 166.500 | 510–603 ms · 225 · 168.900 | 522–533 ms · 148 · **178.700** |

- **Móvil** (390×844, vista cercana): figuras 222 ms; Quaternius 246 ms; **3 realistas 205 ms**; 9 realistas 222 ms.
- **Descarga inicial de modelos**: Quaternius 939 KB; **3 realistas 928 KB** (LOD2). El LOD1 se baja al enfocar un puesto: unos 0,45 s en local.
- **Memoria JS** (desarrollo): 97–144 MB en todas las escenas (variación de la medida).
- **Mejoras introducidas**:
  1. el LOD2 hace la escena inicial más ligera que con Quaternius;
  2. los trabajadores fuera de cámara no suben de nivel: con 9, de 285.000 a 178.700 triángulos y de 204 a 147 texturas en el foco;
  3. tope de LOD1 en móvil;
  4. liberación al salir.
- **FPS**: con GPU por software, entre 1,5 y 2,3 en escritorio y entre 4 y 5 en móvil. **No representan una GPU real**: sirven para comparar escenas entre sí.

## 5. Capturas

Están en `docs/capturas-fase431/`:

| Archivo | Contenido |
|---|---|
| `01-los-tres-retrato.png` | Retratos de los tres |
| `02-los-tres-cuerpo-completo.png` | Cuerpo completo de los tres |
| `retrato-*`, `tres-cuartos-*`, `cuerpo-*` | Vistas de cada uno |
| `03-oficina-vista-cercana.png`, `04-oficina-vista-general.png` | Oficina |
| `05` a `07` | Puesto de Alex, Marcus y Sofia, con su ficha |
| `08-movil-oficina.png`, `09-movil-sofia.png` | Móvil |
| `10-cerca-*` | Primer plano de cada uno en su puesto (LOD0) |
| `11-los-tres-sentados.png` | Los tres sentados |

## 6. Próximos pasos propuestos

1. Aprobar a Marcus y Sofia, o pedir retoques.
2. Decidir si se cambia el traje de Alex a azul marino.
3. Producir los otros 6 con sus fichas: unos 20 minutos de máquina cada uno, más la revisión visual.
4. Probar en un móvil y un portátil reales antes de publicar.
