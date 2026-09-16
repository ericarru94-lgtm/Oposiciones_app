# Favoritos: marcar preguntas para repasar aparte

## 1. Qué hace

Deja marcar cualquier pregunta con ★ desde `TestRunner` (funciona en
"Practicar tema", "Repasar hoy", Simulacro y Examen oficial — es el mismo
componente en los cuatro) y practicar después solo esas, desde `/favoritas`.
Es independiente del algoritmo SM-2 de repetición espaciada (`lib/sm2.ts`):
SM-2 decide *cuándo* te toca repasar algo según tus aciertos; favoritos es
una lista que decide el propio usuario a mano, para volver a una pregunta
concreta cuando quiera.

Solo disponible con sesión iniciada — la estrella no se muestra en el
mini-test anónimo del onboarding.

## 2. Piezas

- **Modelo `PreguntaFavorita`** (`prisma/schema.prisma`): fila por
  (`usuarioId`, `preguntaId`), con `onDelete: Cascade` en ambas relaciones
  — se borra sola tanto si se borra el usuario (ver `DELETE /api/auth/cuenta`
  en `backend/docs/`) como si se borra la pregunta.
- **`routes/favoritos.ts`**, montado en `/api/favoritos`:
  - `GET /ids`: solo los ids favoritos del usuario — deliberadamente ligero,
    para que `TestRunner` lo pida una vez al montarse (sin importar de qué
    endpoint vinieran las preguntas del test) y sepa qué estrella pintar
    rellena.
  - `GET /`: las preguntas favoritas completas, mismo formato que
    `/preguntas/aleatorias` (sin la respuesta correcta), para practicarlas.
  - `POST /:preguntaId` / `DELETE /:preguntaId`: marcar/desmarcar.
    Idempotentes en ambos sentidos.
- **`TestRunner.tsx`**: pide `GET /favoritos/ids` una vez al montarse (si
  hay sesión) y pinta ★/☆ junto al enunciado. El toggle es optimista
  (actualiza el icono antes de que responda el servidor) y revierte si la
  llamada falla.
- **`pages/Favoritas.tsx`**: página nueva, mismo patrón que
  `RepasarHoy.tsx`/`PracticarTema.tsx` (`CargadorTest` + `TestRunner`).
  Enlazada desde `Progreso.tsx`.

## 3. Decisiones deliberadas

- **No cuenta contra el límite diario del plan gratuito**: a diferencia de
  "Practicar tema" o "Repasar hoy" (que si consumen sesiones, ver
  `lib/dailyLimit.ts`), repasar favoritas es revisar contenido que el
  usuario ya vio y marcó él mismo — no una sesión de estudio nueva.
- **Solo preguntas `verificada`**: marcar una pregunta en `borrador` (o ya
  `anulada`) responde 404 — nunca llegan a servirse en ningún test, así que
  tampoco tiene sentido poder favoritearlas.
- **El estado de favorito no viaja con cada pregunta**: en vez de añadir
  `esFavorita` a las respuestas de `/aleatorias`, `/simulacro`,
  `/examen-oficial` y `/progreso/hoy` (cuatro endpoints a tocar y mantener
  sincronizados), `TestRunner` pide la lista de ids una sola vez y la cruza
  en el cliente. Un fetch más por test, pero un único punto de verdad.
