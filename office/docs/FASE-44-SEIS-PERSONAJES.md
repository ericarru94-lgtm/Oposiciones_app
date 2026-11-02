# Fase 4.4 · Los seis personajes realistas restantes

Fecha: 02/11/2026. Todo el trabajo es local: sin commit, push ni despliegue. Coste: **0 €**.

No se ha modificado el motor, los agentes, los prompts, los permisos, los presupuestos, Supabase, la base de datos, la autenticación ni las misiones. Los seis nuevos siguen **inactivos**.

## A. Matriz de identidad (los nueve)

| Agente | Sexo · edad | Complexión | Cara | Peinado | Pelo | Ojos | Vestimenta (prenda del pack) | Color principal | Dpto. |
|---|---|---|---|---|---|---|---|---|---|
| Alex | H · ~40 | Media-atlética, alto | Regular | `short02`, peinado | Castaño | Marrón claro | Traje gris antracita y corbata | Gris antracita | Dirección |
| Marcus | H · ~30 | Corpulenta | Cuadrada, mandíbula marcada | `short01`, muy corto | Negro | Marrón claro | Camisa azul y vaqueros | Azul | Comercial |
| Sofia | M · ~30 | Esbelta | Ovalada | `long01`, largo | Castaño | Verdes | Blusa de rayas y falda | Granate | Marketing |
| **Daniel** | H · ~33 | Media | **Alargada** | `short03`, flequillo de lado | Castaño oscuro | Azul verdoso | Camisa verde oliva de rayas y chinos beige (`male_casualsuit03` recoloreada) | Verde oliva y beige | Contenidos |
| **Lucia** | M · ~29 | Esbelta | **Redondeada**, nariz respingona | `bob01`, media melena asimétrica | Negro | Marrón claro | Camiseta coral sin logotipo y pantalón gris marengo (`female_casualsuit01` recoloreada) | Coral | Creatividad |
| **David** | H · ~31 | **Alto y delgado** | **Triángulo invertido**, mentón marcado | `short04`, corto peinado atrás | Negro | Marrón claro | Camiseta azul petróleo y pantalón casi negro (`male_casualsuit06` recoloreada, sin logotipo) | Azul petróleo | Automatización e IA |
| **Emma** | M · ~31 | Media | **Suave**, sonrisa ancha | `ponytail01`, coleta | Cobrizo | Azules | Camisa crema y pantalón azul marino (`male_casualsuit01` recoloreada) | Crema y azul marino | Atención al cliente |
| **Oscar** | H · ~38 | **Robusta** | **Rectangular**, nariz ancha | `afro01`, corto rizado | Oscuro | Grises | Chaqueta burdeos y pantalón gris oscuro (`male_casualsuit05` recoloreada) | Burdeos | Finanzas y datos |
| **Victoria** | M · ~35 | Media | **Angulosa**, mentón definido | `braid01`, recogido en trenza | Castaño oscuro | Azul intenso | Traje de pantalón verde oscuro con camisa clara (`male_elegantsuit01`, solo la tela recoloreada) | Verde oscuro | Calidad |

Ningún peinado, prenda ni combinación de piel, pelo y ojos se repite. Están los 10 peinados del pack excepto `bob02`.

**Cambios respecto a las fichas de la fase 4.3.1**:

- **Oscar**: lleva chaqueta burdeos en lugar de traje gris, porque así hay solo un traje de hombre (Alex).
- **Victoria**: lleva el traje recoloreado en verde, con trenza.
- **Lucia**: media melena (bob01) en lugar de recogido.
- **Oscar**: no tiene canas. La textura del pelo es oscura y un factor de color solo puede oscurecer.

## B. Modelado

Herramientas: Blender 5.2.3 (`bpy`), MPFB2 (commit 6ff1eb3) y glTF-Transform 4.5.1. Script nuevo: `recolorear_ropa.py`.

| Personaje | Triángulos LOD0 / LOD1 / LOD2 | Peso LOD0 / LOD1 / LOD2 |
|---|---|---|
| Daniel | 28.202 / 14.816 / 3.377 | 1,81 / 0,87 / 0,28 MB |
| Lucia | 35.386 / 18.262 / 4.240 | 1,95 / 0,99 / 0,31 MB |
| David | 31.138 / 16.508 / 3.976 | 1,78 / 0,90 / 0,30 MB |
| Emma | 43.444 / 22.808 / 5.213 | 2,47 / 1,23 / 0,37 MB |
| Oscar | 29.924 / 16.358 / 4.233 | 2,17 / 1,02 / 0,37 MB |
| Victoria | 42.682 / 24.118 / 5.432 | 1,98 / 1,20 / 0,35 MB |

- Todos tienen 163 huesos, un solo esqueleto y 8 texturas WebP (1024 px en LOD0).
- **Ropa recoloreada sin tocar la malla**:
  - el script separa las piezas del patrón (islas UV) en parte de arriba y de abajo;
  - tiñe conservando arrugas y costuras;
  - borra logotipos y suaviza estampados.
- **Posturas** (medidas en la escena, LOD0):
  - muñecas a 0,77–0,79 m;
  - rodillas a 0,57–0,59 m;
  - pies a 0,05–0,15 m;
  - sin atravesar la silla ni la mesa.
- **Inactivos**: los seis nuevos usan la postura «off» y no se animan.
  - Antes se dibujaban en gris uniforme, pero en un modelo con textura eso deja una mancha. Ahora se atenúan un 40 %.
  - La etiqueta «Inactivo», la ficha «fuera del piloto» y el estado no cambian.

## C. Retratos

- Mismo proceso que la fase 4.3.2 (`scripts/models/retratos/`): 256×256 WebP sin metadatos.
- El retrato de Alex se regeneró de prueba y salió **idéntico píxel a píxel**.

| Retrato | Peso |
|---|---|
| Daniel | 9,6 KB |
| Lucia | 7,9 KB |
| David | 8,2 KB |
| Emma | 7,9 KB |
| Oscar | 9,0 KB |
| Victoria | 8,1 KB |

- Los 9 retratos suman **76 KB**.
- `PORTRAIT_STATUS`: los 9 están en «realista». Se ven en la lista, en la ficha lateral y en la página de cada empleado.

## D. Rendimiento

**Medido con GPU por software (SwiftShader) en el navegador, en modo desarrollo. No hay medidas en hardware físico.**

| Escena (escritorio 1440×900) | Vista cercana | Vista general | Foco en un puesto |
|---|---|---|---|
| Figuras por código (`?modelos=no`) | 642 ms · 223 llamadas · 155.000 triángulos | 515 ms · 237 · 157.400 | 495 ms · 110 · 116.900 |
| **9 realistas** | 646 ms · **190** · **98.700** | **468 ms** · 204 · 101.100 | 542 ms · 136 · 119.300 |

- **Móvil** (390×844): 9 realistas 202 ms, figuras 242 ms.
- **Descarga**:
  - al abrir, los 9 en LOD2: **2,86 MB**;
  - al enfocar un puesto se cargan los LOD1 que están a la vista;
  - nunca se cargan los 9 LOD0 a la vez (solo se usan al acercarse mucho a un puesto).
- **Carga y descarga**: al pasar a la lista se liberan los modelos y al volver a 3D se descargan de nuevo (comprobado).
- **Fallo encontrado y corregido** (venía de la fase 4.3.1):
  - mientras cargaba el GLB, la figura de reserva se fusionaba con el mobiliario estático;
  - su copia fusionada seguía visible después: se veían figuras grises superpuestas y sobraban triángulos;
  - ahora la figura de reserva se marca como dinámica.
  - Las cifras de triángulos de la fase 4.3.1 incluían esas figuras.

## E. Licencias

Todo sale del pack «MakeHuman system assets» (CC0 1.0), ya descargado el 02/11/2026. No se ha descargado nada nuevo.

`public/models/equipo/LICENCIAS.md` recoge:

- recurso por recurso, la licencia y el autor del índice oficial, y su SHA-256;
- las modificaciones;
- la huella del GLB de Blender y de cada archivo final;
- los retratos.

## F. Pruebas

- `tsc`: sin errores.
- Vitest: **268/268** en la segunda ejecución.
  - En la primera falló el grupo con base de datos temporal, una incidencia conocida e intermitente que esta fase no toca.
  - Hay pruebas nuevas:
    - un modelo por agente del registro;
    - fuera del piloto, inactivo y sin animación;
    - licencia, huella, postura y peso de los 27 archivos;
    - los 9 retratos.
- Navegador: **17/17**.
- `next build`: OK. El paquete del navegador no contiene prompts ni secretos.
- Los 12 archivos aprobados (9 GLB y 3 retratos de Alex, Marcus y Sofia) tienen el **mismo SHA-256** que antes.

## G. Límites conocidos

1. Los peinados `short03` (Daniel) y `bob01` (Lucia) tapan un ojo por diseño del recurso; el flequillo de Victoria también tapa parte.
2. La corbata del traje de Victoria viene con la prenda (el pack no tiene traje femenino de pantalón).
3. Emma y Victoria llevan prendas pensadas para hombre, ajustadas por MPFB2 a su cuerpo.
4. Las cejas siempre son oscuras: la textura no se puede aclarar con un factor de color.
5. En la vista general, las caras siguen siendo pequeñas: se reconocen por la ropa y el color.

## H. Archivos

- **Creados**:
  - `public/models/equipo/{daniel,lucia,david,emma,oscar,victoria}-realista{,-lod1,-lod2}.glb` (18 archivos)
  - `public/avatars/equipo/{daniel,lucia,david,emma,oscar,victoria}.webp`
  - `scripts/models/mpfb/personajes/{6 fichas}.json`
  - `scripts/models/mpfb/recolorear_ropa.py`
  - `docs/FASE-44-SEIS-PERSONAJES.md`
  - `docs/capturas-fase44/`
- **Modificados**:
  - `src/lib/office/staff-models.ts`: 9 modelos; se quita `?prueba9`.
  - `src/lib/agents/portraits.ts`: 9 retratos.
  - `src/components/office/scene/staff-model.tsx`: atenuado de inactivos realistas.
  - `src/components/office/scene/workstation.tsx`: figura de reserva dinámica.
  - `scripts/models/mpfb/postproceso.mjs`: modo ficha, con color de pelo y ropa. El modo anterior reproduce idéntico el GLB aprobado de Sofia.
  - `tests/staff-models.test.ts` y `tests/portraits.test.ts`.
  - `public/models/equipo/LICENCIAS.md`.
- **Eliminados**: ninguno.
