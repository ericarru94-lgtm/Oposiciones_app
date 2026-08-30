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

Pero nunca vuelve a pisar `estado`/`enunciado`/`opciones`/`respuestaCorrecta`
de una pregunta ya verificada o anulada con contenido distinto. Hay dos
excepciones, ambas deliberadas y ambas basadas en el mismo principio —
completar o reordenar, nunca reescribir contenido:

1. Si a una fila ya revisada le falta `explicacion` o `fuente` en la base
   de datos y el dataset ya trae contenido nuevo para ese campo (p.ej. las
   explicaciones generadas por IA a posteriori, ver más abajo), el
   reimport sí lo rellena — nunca sobreescribe un campo que ya tuviera
   contenido.
2. Si el dataset reordena las `opciones` de una fila ya revisada (p.ej.
   para repartir mejor la posición de la respuesta correcta entre A/B/C/D,
   ver la sección de aleatorización más abajo) pero el **conjunto de
   textos de opción es exactamente el mismo** y el texto de la respuesta
   correcta tampoco cambia, el reimport aplica el nuevo orden. Es un
   reordenamiento verificado contenido-por-contenido, no una reescritura:
   si el conjunto de textos difiere en algo — lo que indicaría una edición
   real hecha a mano por un admin —, el reimport no toca nada, igual que
   siempre.

El log final del script reporta las cinco cosas por separado:
`X creadas, Y actualizadas, Z completadas (explicación/fuente añadidas a
preguntas ya revisadas), N reordenadas (opciones reordenadas sin cambiar
contenido en preguntas ya revisadas), W omitidas sin cambios`.

Esta segunda excepción es la que hace que la aleatorización de la
posición de la respuesta correcta (mezclada una sola vez sobre el propio
dataset JSON) llegue también a las bases de datos que ya tenían esas
preguntas importadas como verificadas — incluida producción, donde
`import-questions.js` se ejecuta automáticamente en cada arranque (ver
sección 4) y es el único cauce por el que el dataset llega a la base de
datos real, al no haber Shell en el plan free para correr un script
suelto a mano.

## 4. Cómo llega el dataset a producción (Render), sin tocar test/E2E

### Por defecto: automático en cada arranque, pensado para el plan free

El plan free de Render no da acceso a Shell, así que no hay terminal
donde ejecutar nada a mano. Por eso `npm run start:prod`
(`backend/docs/despliegue.md`) incluye el import como parte del propio
arranque del servicio:

```
prisma migrate deploy && (node dist/scripts/import-questions.js || true) && node dist/server.js
```

No hace falta que hagas nada — en el próximo deploy (o el próximo
arranque tras un reinicio) ya se ejecuta solo. Por qué es seguro
repetirlo en **cada** arranque, incluidos los varios reinicios al día
típicos de un plan free:

- **No duplica nada**: hace upsert por `id` de pregunta y por
  (`bloque`, `numero`) de tema — el mismo id siempre actualiza la misma
  fila, nunca crea una copia.
- **No pisa el trabajo de revisión**: desde el arreglo de la sección 3,
  cualquier pregunta que un admin ya haya verificado o anulado se omite
  por completo, sin importar lo que diga el JSON.
- **No bloquea el arranque si falla**: el `|| true` hace que un error
  puntual del import (p.ej. la base de datos tarda en aceptar
  conexiones justo al arrancar) quede registrado en los logs pero nunca
  impida que el servidor arranque — solo `prisma migrate deploy` puede
  detener el arranque si falla, el import nunca.
- **Un único servicio**: el plan free no escala a varias instancias en
  paralelo, así que no hay ninguna carrera entre dos imports
  simultáneos que considerar.

Verificado localmente antes de este cambio, ejecutando `start:prod` dos
veces seguidas contra la misma base de datos (con preguntas ya
verificadas de antes): mismo total de preguntas y temas en ambas
pasadas, ninguna verificada revertida a borrador.

El único coste real es de tiempo: son ~414 comprobaciones contra la base
de datos en cada arranque (una por pregunta, para decidir si se omite o
no), lo que añade cierta latencia extra a cada arranque/reinicio — no
afecta a la salud de la app ni a las peticiones ya en curso, solo alarga
un poco el tiempo hasta el primer `/api/health` que responde tras un
reinicio en frío.

**Qué hacer para que las preguntas verificadas de tu base local lleguen
a producción**: nada especial — el propio dataset
(`backend/data/preguntas_auxiliar_estado_combinado.json`) ya está en el
repo con esos 55 estados a `"verificada"` guardados en el JSON tal cual
salieron de las revisiones hechas hasta ahora. En cuanto Render
redespliegue (o reinicie) con este cambio, el import los deja en la base
de datos de producción. Si no quieres esperar al próximo push, entra al
dashboard de Render y pulsa **Manual Deploy** (o el reinicio manual del
servicio) para forzarlo ahora — no hace falta cambiar nada más.

### Si en algún momento tienes Shell (plan de pago, u otro proveedor)

Con acceso a Shell en el servicio, `DATABASE_URL` ya es la de producción
ahí dentro (la inyecta la plataforma, igual que en tiempo de ejecución
normal), así que puedes ejecutar el import a mano, puntualmente, sin
esperar a un redeploy:

```bash
npm run import:questions
```

O desde tu propia máquina, con la cadena de conexión **externa** de tu
Postgres (Dashboard → tu Postgres → "External Database URL" — la
interna, `Internal Database URL`, solo resuelve dentro de la red privada
de la plataforma) pasada inline, sin guardarla en ningún `.env`:

```bash
cd backend
DATABASE_URL="postgresql://...la-externa-de-tu-proveedor..." npm run import:questions
```

### Qué NO hacer

- No lo ejecutes con `npm run pretest`, `e2e:reset` ni ningún script que
  lleve `dotenv -e .env.test`/`.env.e2e` delante — esos apuntan,
  siempre, a las bases de datos desechables de test/E2E.
- Nunca pegues una cadena de conexión de producción en `backend/.env`:
  ese archivo es el que usa `npm run dev`, y un desarrollador (u otro
  script) podría acabar escribiendo en producción sin darse cuenta.
- Tras un deploy, confirma con un vistazo rápido a
  `/admin/preguntas?estado=verificada` (o a la propia app) que el
  recuento cuadra con lo esperado, en vez de asumir que fue bien solo
  porque el log de arranque no mostró un error.
