# Frontend — Oposiciones App

React + TypeScript + Vite + Tailwind v4 + React Router. Ver el
[README principal](../README.md) para la visión general del proyecto y
cómo levantar el backend.

## Puesta en marcha

```bash
cp .env.example .env   # ajusta VITE_API_URL si el backend no está en localhost:3001
npm install
npm run dev            # http://localhost:5173
```

Requiere el backend corriendo (ver `../backend/README` / raíz del repo).

## Estructura

```
src/
  api/          cliente fetch tipado + wrappers por endpoint
  context/      SessionContext: token, sesión anónima, nivel de onboarding pendiente
  components/   TestRunner (motor de test reutilizable), tarjetas, gráfico de evolución...
  pages/
    onboarding/ mini-test sin registro -> nivel -> primer test (Constitución) -> alta
    Home, Progreso, RepasarHoy, PracticarTema, Upgrade, Login
```

## Flujo de sesión anónima -> cuenta

El onboarding se responde sin cuenta usando un `sesionAnonima` (UUID
guardado en localStorage). Al registrarse o iniciar sesión justo después,
el frontend manda ese `sesionAnonima` al backend, que reasigna esos
intentos al usuario y reconstruye su progreso SM-2 (ver
`backend/src/lib/reclamarIntentosAnonimos.ts`) — así el Home ya refleja lo
practicado en el onboarding en vez de mostrar todo en cero.
