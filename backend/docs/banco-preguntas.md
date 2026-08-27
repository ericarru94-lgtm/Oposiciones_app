# Banco de preguntas: qué hay, cómo ampliarlo y cómo cargarlo en producción

## 1. Ya existe un banco real (no es el de test/E2E)

`backend/data/preguntas_auxiliar_estado_combinado.json` es el dataset
real del proyecto — combina preguntas de exámenes oficiales anteriores
con preguntas generadas y verificadas por IA, tal como se planteó desde
el principio. **No tiene nada que ver** con los datos de
`backend/src/scripts/seed-e2e.ts` (un puñado de preguntas de fixture,
solo para los tests E2E, en la base de datos desechable
`oposiciones_e2e`) ni con las fixtures que crean los tests de
`backend/src/routes/__tests__/*.test.ts` (con ids `test-*`, en
`oposiciones_test`). Ninguno de esos dos se parece ni se acerca al
dataset real.

Estado actual del dataset (contado directamente del JSON):

| | |
|---|---|
| Total de preguntas | 414 |
| Temas | 28 (+ psicotécnicas, que no llevan tema asignado) |
| `origen: examen_oficial` | 360 |
| `origen: generada_ia` | 54 |
| `tipo: teorica` | 316 |
| `tipo: psicotecnica` | 98 |
| **`estado: verificada`** | **55** |
| `estado: borrador` | 354 |
| `estado: anulada` | 5 |

El dato que de verdad importa para el mini-test y el onboarding es
`verificada`: es el único estado que `/preguntas/aleatorias` sirve por
defecto (ver `backend/docs/estados-preguntas.md`). Con solo 55
verificadas:

- Solo **11 de los 28 temas** tienen alguna pregunta verificada; los
  otros 17 (Cortes Generales, El Gobierno y la Administración, Educación
  para la igualdad, la mayoría de ofimática, etc.) están a 0 y aparecerán
  como "no hay preguntas disponibles" tanto en `/practicar/:temaId` como
  en "Repasar hoy".
- **Cero preguntas psicotécnicas están verificadas** (las 98 existentes
  siguen en `borrador`) — la parte psicotécnica del banco es, hoy,
  completamente invisible para un usuario real.
- Constitución (el tema que usa el onboarding para "tu primer test") solo
  tiene 4 verificadas.

Así que aunque **sí existe un banco real** y no hace falta generarlo
desde cero, importarlo tal cual a producción no resuelve el problema de
raíz: el mini-test/onboarding seguirán viéndose pobres (pocos temas,
ninguna psicotécnica) hasta que se verifique más contenido. Ver la
sección 3.

## 2. Cuánto haría falta verificar, y con qué proceso

No hay un mínimo "mágico", pero una referencia razonable para que el
mini-test aleatorio y el "repasar hoy" tengan variedad real:

- **Al menos 5-8 preguntas verificadas por tema** en los 28 temas (hoy
  hay una media de ~2 en los 11 temas que tienen alguna, y 0 en el resto)
  — con 356 en borrador de sobra, la mayoría de temas ya tiene margen
  suficiente sin generar ni una pregunta nueva, solo revisando lo que ya
  existe.
- **Verificar un lote de psicotécnicas** (empezar por Windows/Excel/Word,
  que ya tienen 15-24 en borrador cada una) — hoy es la carencia más
  visible del banco.
- Para huecos reales donde no haya suficientes preguntas en borrador de
  examen oficial, generar nuevas con `origen: "generada_ia"` siguiendo el
  mismo formato del JSON (ver la interfaz `PreguntaJSON` en
  `backend/src/scripts/import-questions.ts`) y añadirlas al dataset antes
  de reimportar.

El proceso para pasar de "borrador" a "verificada" ya está construido —
no hace falta inventar nada nuevo, es exactamente para esto que existe la
herramienta de revisión editorial:

1. Iniciar sesión con una cuenta en `ADMIN_EMAILS` y entrar a
   `/admin/revision`.
2. Filtrar por bloque/tema y estado `borrador`.
3. Por cada pregunta: revisar enunciado/opciones/respuesta, corregir si
   hace falta (errores de tipeo, una opción ambigua, falta de
   explicación/fuente), y pulsar "Verificar" (o "Anular" si ya no
   procede — p.ej. una pregunta sobre una ley derogada).
4. Repetir hasta cubrir los temas/tipos que falten. Ver
   `backend/docs/estados-preguntas.md` para el detalle completo del
   flujo borrador → verificada → anulada.

Para añadir preguntas **nuevas** (no solo revisar las que ya están en el
JSON): no hay endpoint para crear preguntas desde cero vía API/UI — se
añaden al JSON (`backend/data/preguntas_auxiliar_estado_combinado.json`,
un id nuevo por pregunta, p.ej. `q0415`) y se reimportan (sección 3). Es
deliberado: mantiene un único archivo versionado como fuente de las
preguntas nuevas, y dentro de la app el único flujo de escritura sobre
preguntas ya existentes es el de revisión editorial.

## 3. Reimportar sin pisar el trabajo de revisión (arreglado en este cambio)

`import-questions.ts` hace upsert por `id` y es idempotente — pensado
para poder reimportar el dataset tras corregirlo o ampliarlo. Pero antes
de este cambio, reimportar **también** sobreescribía `estado` (y
enunciado/opciones/explicación/fuente) de preguntas que un admin ya había
revisado en producción: si el JSON seguía diciendo `"borrador"` para una
pregunta que en producción ya estaba `"verificada"`, un reimport la
devolvía a borrador y deshacía cualquier corrección hecha a mano.

Ahora el script comprueba el estado ya guardado antes de tocar una fila:
si ya no es `"borrador"` (o sea, ya la revisó un admin), la **omite por
completo** y no la toca. Reimportar sigue sirviendo para:
- Crear preguntas nuevas (ids que no existían).
- Actualizar preguntas que siguen en borrador (para corregir el dataset
  antes de que nadie las haya revisado todavía).

Pero nunca vuelve a pisar una pregunta ya verificada o anulada. El log
final del script ahora reporta las tres cosas por separado:
`X creadas, Y actualizadas, Z omitidas (ya revisadas por un admin)`.

## 4. Cómo ejecutar el import contra producción (Render), sin tocar test/E2E

`npm run import:questions` usa el `DATABASE_URL` que tenga activo el
proceso en ese momento — igual que con las migraciones, la aislación
entre entornos depende de qué `DATABASE_URL` ve el comando, no de nada
más. Dos formas de apuntarlo a la base de datos de producción, de más a
menos preferida:

### Opción A (recomendada): Shell de Render

Si tu plan de Render incluye la pestaña **Shell** en el servicio del
backend, ábrela — ahí `DATABASE_URL` ya es la de producción (la inyecta
Render, exactamente como en tiempo de ejecución normal), así que no hay
ningún riesgo de apuntar por error a tu base de datos local ni de que la
cadena de conexión de producción pase por tu máquina o por un `.env`:

```bash
npm run import:questions
```

Como el repo ya está desplegado ahí, el dataset
(`backend/data/preguntas_auxiliar_estado_combinado.json`) ya está en el
mismo sitio que el código — no hace falta subir nada aparte.

### Opción B: desde tu máquina, con `DATABASE_URL` sobreescrita solo para ese comando

Si no tienes Shell disponible, cópiate la cadena de conexión **externa**
de tu base de datos de Render (Dashboard → tu Postgres → "External
Database URL" — la interna, `Internal Database URL`, solo resuelve
dentro de la red privada de Render y no funciona desde fuera) y
ejecútala así, **sin** guardarla en ningún `.env`:

```bash
cd backend
DATABASE_URL="postgresql://...la-externa-de-render..." npm run import:questions
```

Pasar `DATABASE_URL` inline (delante del comando, en la misma línea) hace
que solo exista para ese proceso concreto — no se escribe en ningún
archivo ni queda exportada en tu shell para el siguiente comando. Nunca
la pegues en `backend/.env`: ese archivo es el que usa `npm run dev`, y
un desarrollador (u otro script) podría acabar escribiendo en producción
sin darse cuenta.

### Qué NO hacer

- No lo ejecutes con `npm run pretest`, `e2e:reset` ni ningún script que
  lleve `dotenv -e .env.test`/`.env.e2e` delante — esos apuntan,
  siempre, a las bases de datos desechables de test/E2E.
- No añadas `import:questions` al `Build Command` ni al `Start Command`
  de Render (`backend/docs/despliegue.md`): es una acción manual y
  deliberada de contenido, no un paso de despliegue — correrla en cada
  arranque no tiene sentido (es idempotente, así que no *rompería* nada,
  pero alargaría cada deploy sin necesidad).
- Después de importar, confirma con un vistazo rápido a `/admin/preguntas?estado=verificada`
  (o a la propia app) que el recuento cuadra con lo esperado, en vez de
  asumir que fue bien solo porque el script no lanzó un error.
