# Frontend — Aprobox

React + TypeScript + Vite + Tailwind v4 + React Router. Ver el
[README principal](../README.md) para la visión general del proyecto y
cómo levantar el backend.

## Puesta en marcha

```bash
cp .env.example .env   # ajusta VITE_API_URL y añade VITE_CLERK_PUBLISHABLE_KEY
npm install
npm run dev            # http://localhost:5173
```

Requiere el backend corriendo (ver `../backend/README` / raíz del repo).

## Estructura

```
src/
  api/          cliente fetch tipado + wrappers por endpoint
  context/      SessionContext: sesión (Clerk o bypass de E2E), sesión anónima, nivel de onboarding pendiente
  components/   TestRunner (motor de test reutilizable), tarjetas, gráfico de evolución...
    admin/      FormularioPreguntaAdmin (edición + verificar/anular)
  pages/
    onboarding/ mini-test sin registro -> nivel -> primer test (Constitución) -> alta
    admin/      Revisión editorial (/admin/revision, solo Usuario.esAdmin)
    Home, Progreso, RepasarHoy, PracticarTema, Upgrade, Login, Registro, Perfil
```

## Revisión editorial

`/admin/revision` (protegida por `RutaAdmin`: exige token + `usuario.esAdmin`)
deja filtrar la cola de preguntas en `borrador` por bloque y tema, editar
enunciado/opciones/respuesta/explicación/fuente, y verificar o anular una
a una. `esAdmin` se activa solo en el backend para los emails listados en
`ADMIN_EMAILS` — ver README principal.

## Autenticación (Clerk)

El registro/login son los componentes de Clerk (`<SignUp/>`/`<SignIn/>`,
ver `pages/Auth.tsx`); el backend verifica la sesión y la relaciona con
`Usuario` vía `clerkUserId`. `SessionContext` expone `estaAutenticado`,
`usuario` (datos propios), `perfilExterno` (nombre/email/foto de Clerk) y
`getToken()` (async, como exige Clerk) al resto de la app. Detalle
completo, incluido el modo de bypass exclusivo de los tests E2E (este
entorno no tiene salida de red hacia Clerk), en
[`backend/docs/clerk.md`](../backend/docs/clerk.md).

## Flujo de sesión anónima -> cuenta

El onboarding se responde sin cuenta usando un `sesionAnonima` (UUID
guardado en localStorage). Al registrarse o iniciar sesión justo después,
el frontend llama a `POST /auth/reclamar-sesion-anonima` con ese id, que
reasigna esos intentos al usuario y reconstruye su progreso SM-2 (ver
`backend/src/lib/reclamarIntentosAnonimos.ts`) — así el Home ya refleja lo
practicado en el onboarding en vez de mostrar todo en cero.

## Tests

Dos suites separadas:

```bash
npm test        # Vitest + Testing Library: componentes en aislado (mocks de la API)
npm run test:e2e # Playwright: flujos completos contra un backend + frontend reales
```

- **Componentes** (`src/**/*.test.tsx`): `TestRunner` (responder, feedback,
  resumen, límite diario) y `FormularioPreguntaAdmin` (editar, verificar,
  anular, validación), con la capa de API mockeada — no tocan ninguna base
  de datos.
- **E2E** (`e2e/*.spec.ts`): arrancan su propio backend (puerto 3002) y
  frontend (puerto 5174), **nunca los de `npm run dev`** (3001/5173), contra
  una base de datos dedicada y desechable (`oposiciones_e2e`) que se
  resetea y siembra con datos deterministas antes de cada tanda —
  ver [`backend/docs/testing.md`](../backend/docs/testing.md) para el
  detalle completo (por qué existe cada tema del seed, cómo se evita el
  cruce entre specs, y los dos bugs reales que esta suite encontró). Corren
  en el modo de bypass de autenticación (sin Clerk real, ver
  [`backend/docs/clerk.md`](../backend/docs/clerk.md)), así que
  `e2e/helpers.ts` inicia sesión creando el usuario directamente por API en
  vez de rellenar un formulario de Clerk.
