# Contenido de estudio (resúmenes por tema): fuentes, formato y estado

## 1. Qué es y qué NO es

Cada tema (`Tema.resumen`) puede tener un resumen/esquema breve de
estudio, pensado como apoyo rápido antes de practicar — **no es un
temario completo** ni pretende sustituir un manual de preparación. Se
accede desde la ficha de cada tema en Tests (`/temas/:id/resumen`,
enlazado como "📖 Ver resumen" en `TemaCard`).

## 2. Fuentes permitidas (importante, por derechos de autor)

Solo dos fuentes:

1. **Texto legal y normativa oficial** (Constitución, leyes citadas
   como fuente de las preguntas de ese tema): es de dominio público en
   España — se puede citar, reproducir o resumir libremente, con
   referencia al artículo (p. ej. "Art. 14 CE").
2. **Redacción propia** a partir de esas leyes públicas, con ayuda de
   IA.

**Nunca** se copian extractos de manuales de academias o webs privadas
con copyright — ni literalmente ni parafraseados de cerca. Si en algún
momento se amplía este contenido con ayuda de una IA, dale sólo el
texto legal público como entrada y pide una redacción propia, nunca le
pidas que "resuma tal academia" o le pegues contenido de terceros para
reescribir.

**Excepción deliberada — temas sin normativa que citar**: los 8 temas
de informática/ofimática del Bloque II (II.5 a II.12: informática
básica, Windows, su explorador, Word, Excel, Access, Outlook e
Internet) no tienen ninguna ley detrás — son contenido técnico, no
jurídico. Para esos temas el resumen es conceptual/técnico y **no
cita ningún artículo ni norma** (inventar una cita legal para una
función de Excel sería peor que no citar ninguna). Mismo criterio ya
aplicado a las preguntas psicotécnicas sin fuente del banco de
preguntas (ver `banco-preguntas.md`).

## 3. Formato de `resumen`

Texto plano con una convención ligera (sin depender de una librería de
markdown), que interpreta `frontend/src/components/EsquemaResumen.tsx`:

- Una línea que empieza por `## ` es un encabezado de sección.
- Una línea que empieza por `- ` es un punto de una lista.
- Una línea en blanco cierra la lista/párrafo anterior.
- Cualquier otra línea no vacía es un párrafo.

## 4. Dónde vive el contenido y cómo se importa

`backend/data/resumenes_temas.json`: un array de
`{ bloque, numero, resumen, resumen_generado_ia }`, aparte del dataset
de preguntas (un tema puede tener resumen sin que eso dependa de
ninguna pregunta en concreto). `import-questions.ts` lo lee (si el
fichero existe) y, al hacer upsert de cada `Tema`, sobreescribe
`resumen`/`resumenGeneradoIA` **solo si ese tema aparece en el
fichero** — igual que ya hace con `nombre`, siempre se refleja la
versión más reciente del fichero, sin la protección de "no tocar tras
revisión editorial" que sí aplica a las preguntas (los temas no tienen
ese flujo de revisión). Un tema ausente del fichero simplemente no ve
tocado su `resumen` en ese import, sea lo que sea que tenga ya en la
base de datos.

El log del import reporta cuántos temas tienen resumen en el fichero:
`N temas sincronizados (M con resumen de estudio en el dataset)`.

## 5. Estado actual: los 28 temas completos

Los 28 temas (16 del Bloque I + 12 del Bloque II) tienen resumen
(`resumen_generado_ia: true` en los 28). El Bloque I salió primero
como piloto; una vez validado, se completó el Bloque II con el mismo
criterio de fuentes de la sección 2 — incluida la excepción de los 8
temas de informática/ofimática sin normativa que citar.

Como con las explicaciones de preguntas generadas por IA
(`Pregunta.explicacionGeneradaIA`, ver `banco-preguntas.md`), el
frontend muestra un aviso discreto bajo el resumen cuando
`resumenGeneradoIA` es `true`, invitando a verificar el contenido con
otras fuentes — sin decir "fuente oficial" ni "normativa pública" de
forma genérica, precisamente porque no todos los resúmenes citan
ninguna (ver la excepción de la sección 2).
