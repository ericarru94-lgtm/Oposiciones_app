# `Pregunta.tablaDatos`: preguntas psicotécnicas de lectura de tablas

Algunas preguntas psicotécnicas de exámenes oficiales reales ("Tabla
Préstamos: ¿editorial con más ejemplares disponibles?", etc.) necesitan una
tabla o serie de datos que el enunciado da por hecha pero que no se capturó
al importar el examen. Sin esa tabla la pregunta no es resoluble, así que el
dataset original las marcaba `estado: "anulada"` — 36 preguntas psicotécnicas
en total, repartidas en 6 grupos de 6 (una tabla compartida por grupo):

| Grupo (origen)              | IDs                          | Tabla          |
|------------------------------|-------------------------------|-----------------|
| Examen 2025                  | `q0049`–`q0054`               | Préstamos (biblioteca) |
| Examen 2025                  | `q0055`–`q0060`               | Desplazamientos (viajes de trabajo) |
| Examen 2024                  | `q2024-0049`–`q2024-0054`     | Biblioteca (ubicación en sala) |
| Examen 2024                  | `q2024-0055`–`q2024-0060`     | Laboratorios (horario semanal) |
| Examen 2022                  | `q2022-0049`–`q2022-0054`     | Ponencias (programa de curso) |
| Examen 2022                  | `q2022-0055`–`q2022-0060`     | Flores (catálogo de floristería) |

## Cómo se generaron las tablas

No se dispone de la tabla original del examen real, así que en vez de
adivinarla se **construyó una tabla nueva y coherente** para cada grupo:
a partir del enunciado y las opciones de las 6 preguntas (que fijan qué
columnas hacen falta y qué respuesta debe salir correcta, porque
`respuesta_correcta` ya viene del examen oficial), se diseñaron filas de
datos que satisfacen simultáneamente las 6 restricciones del grupo —
comprobado programáticamente (sumas, medias, ratios, filtros) antes de
escribir nada en el dataset, no a mano. Solo se marcaron `verificada` las
preguntas cuyo grupo completo superó esta comprobación; ninguna se marcó
verificada de forma aislada.

Esto significa que los datos de la tabla son **ficticios pero
consistentes**: la pregunta es genuinamente resoluble con la tabla que
acompaña, y tiene una única respuesta correcta que coincide con la que ya
traía el examen oficial. No pretende reconstruir la tabla exacta que vio
quien hizo el examen real.

## Modelo de datos

`Pregunta.tablaDatos` (`Json?`, migración `20260831114308_pregunta_tabla_datos`):

```ts
{
  titulo: string;
  columnas: string[];
  filas: (string | number)[][];
}
```

`null` en el resto de preguntas (la inmensa mayoría). Se sirve junto con el
resto de la pregunta en todos los endpoints que exponen preguntas antes de
responder (`/aleatorias`, `/simulacro`, `/examen-oficial`, `/progreso/hoy`)
y se renderiza como tabla HTML en `TestRunner.tsx`, justo debajo del
enunciado. La herramienta de admin (`FormularioPreguntaAdmin.tsx`) la
muestra en solo lectura — para editarla hay que tocar el dataset y
reimportar, igual que el resto de contenido no soportado directamente por
el formulario.

## Reimportación

`import-questions.ts` protege por diseño el contenido de preguntas ya
revisadas (`estado !== "borrador"`) frente a un reimport. Las 36 preguntas
de este documento eran `anulada` por clasificación automática del import
original, no por revisión editorial humana, así que se añadió una
excepción acotada (`reviveAnulada` en `import-questions.ts`): una pregunta
`anulada` sin `tablaDatos` se reescribe por completo cuando el dataset le
añade una tabla nueva y la reclasifica a un estado distinto de `anulada`.
Fuera de ese caso concreto, la protección habitual sigue aplicando.
