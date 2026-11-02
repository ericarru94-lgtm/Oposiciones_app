# Fase 4.3.2 · Retratos de los trabajadores y consolidación visual

Fecha: 02/11/2026. Todo el trabajo es local: sin commit, push ni despliegue. Coste: 0 €.

## A. Avatares

- **Origen**: renderizados desde los **modelos 3D aprobados** de cada trabajador (LOD0), con la misma malla, texturas y materiales que en la oficina. No hay caras nuevas ni imágenes externas.
- **Cámara**:
  - centrada en el hueso `head`, con giro de tres cuartos leve (0,22 rad), 17° de campo y 1,12 m de distancia;
  - encuadre de cabeza y hombros, igual para los tres.
- **Luz de retrato**: clave cálida a 45°, relleno frío suave y contraluz; mismo mapa de reflejos que la oficina.
- **Fondo**: transparente. El círculo de fondo (degradado azul marino) y el borde los pone la interfaz, con la estética de la app.
- **Formato**: WebP con transparencia, 256×256 px (nítido a 64 y a 96 px en pantallas de alta densidad), sin metadatos.

| Retrato | Peso |
|---|---|
| alex.webp | 9,1 KB |
| marcus.webp | 7,3 KB |
| sofia.webp | 8,9 KB |
| **Total** | **25,3 KB** |

- **Ubicaciones actualizadas** (todas las que muestran caras):
  1. lista de trabajadores (vista «Lista»);
  2. ficha lateral (en 3D y en la lista, también en móvil);
  3. página de cada empleado (`/empleados/[id]`).
- El **Centro de mando**, los encargos y las reuniones no muestran caras, solo nombres, así que no había nada que cambiar.
- **Capturas**: `docs/capturas-fase432/`.
  - `00-antes-despues-lista.png` y `00-los-tres-en-la-lista.png`;
  - `01` lista completa; `02`–`04` tarjetas de Alex, Marcus y Sofia;
  - `05` ficha lateral; `06`–`09` páginas de Alex, Marcus, Sofia y Daniel (inactivo);
  - `10` centro de mando; `11`–`12` oficina; `13`–`14` móvil.

## B. Personajes

- **Alex, Marcus y Sofia mantienen su identidad**: no se ha modificado ningún modelo. El SHA-256 de los 9 GLB es el mismo que al terminar la fase 4.3.1.
- **Mejoras de realismo evaluadas**:
  - **Suavizado de bordes del pelo, cejas y pestañas** (`alphaToCoverage`, coste 0 KB):
    - se probó y se midió en la misma toma: cambia el 0,04 % de los píxeles, solo en el borde del pelo;
    - no se aprecia a la distancia de la oficina, así que **no se aplicó** (sin complejidad sin beneficio visible).
  - **Materiales de piel más naturales** (brillo tipo terciopelo, transluminiscencia):
    - **no aplicados**: cambiarían el aspecto aprobado y el retrato dejaría de coincidir con la oficina;
    - con la cámara isométrica, la cara apenas se ve.
  - **Luz de la oficina sobre las caras**: el factor limitante es el ángulo de la cámara y los monitores delante, no la luz.
  - **Conclusión**: ningún cambio visual en los modelos.
  - La mejora apreciable de esta fase son los retratos, que enseñan la cara de cada trabajador donde antes había un dibujo.

## C. Arquitectura

- **Fuente de verdad**: `src/lib/agents/portraits.ts`.
  - `PORTRAIT_STATUS`: estado del retrato de los 9 agentes, por identificador estable (`realista` o `pendiente`).
  - `portraitOf(id)`: ruta, tamaño y modelo de origen, o `null`.
  - Nombre y departamento no se duplican: siguen en el catálogo y el registro de agentes.
- **Componente**: `AgentAvatar` ahora recibe `agentId`.
  - Con retrato: imagen circular con el fondo y el borde del diseño.
  - Sin retrato: el avatar dibujado de siempre, sin cambios.
  - Lo usan `office-view.tsx` (lista y ficha lateral) y `empleados/[id]/page.tsx`.
- **Inactivos** (Daniel, Lucia, David, Emma, Oscar y Victoria):
  - siguen con su avatar dibujado, en tarjetas al 70 % de opacidad y con «Inactivo · fuera del piloto»;
  - no se ha inventado ningún retrato.
- **Garantías (pruebas)**:
  - un estado por cada agente del registro;
  - los retratos realistas son exactamente los agentes con modelo 3D;
  - el retrato sale del mismo GLB que usa la oficina;
  - un nombre igual con otro identificador no hereda el retrato.
- **Servido como archivos estáticos**: sin Supabase ni dependencias nuevas.
  - El proxy de autenticación ya excluía `.webp`.
- **Caché** (`next.config.ts`): `public, max-age=86400, stale-while-revalidate=604800` **solo** para `/avatars/equipo/*`. No es `immutable` porque los nombres no llevan versión.
  - Se probó también para `/models/equipo/*` y **se retiró**: en producción, a una visita sin sesión el proxy le responde a un `.glb` con una redirección a `/login` (307). Esa redirección habría llevado la cabecera de caché y el navegador podría haberla guardado un día.
  - Comprobado con `next start`: la redirección ya no lleva caché.
- **Recomendación pendiente (autenticación, no tocada)**: el proxy sí intercepta los `.glb`. Funciona con la sesión iniciada, pero añade una comprobación por modelo; se podría excluir `.glb` del `matcher`, que es una decisión de seguridad tuya.

## D. Rendimiento

- **Peso añadido**: 25,3 KB de retratos en total (8,4 KB de media).
  - Solo se descargan en la lista, la ficha y la página del empleado, nunca en la vista 3D si no se abre una ficha.
- **Sin descargas repetidas** (medido):
  - cada retrato se descarga una vez (código 200);
  - al volver a otras páginas el navegador solo revalida (código 304, 0 bytes) o lo sirve de memoria.
  - En producción, con la cabecera de caché (comprobada con `next start`), no se revalida en 24 h.
- **Vista 3D**: los retratos no intervienen en el render. Los modelos siguen cargando por niveles y se liberan al pasar a la lista (comprobado de nuevo: al volver a 3D se descargan otra vez).
- **Móvil**: retratos nítidos a 64 px, también en la ficha inferior (captura `14`).
- **Límite**: mediciones en el navegador con GPU por software; sin hardware físico.

## E. Pruebas

- `tsc`: sin errores.
- Vitest: **207/207**, con 7 nuevas en `tests/portraits.test.ts`.
  - Incidencia conocida, anterior a esta fase: los 3 grupos que arrancan una base de datos temporal (budget-recovery, corrections y fase3-engine) fallan a veces cuando se lanzan juntos; repetidos, pasan. Esta fase no los toca.
- Navegador: **17/17**.
- `next build`: OK.
- Comprobaciones visuales:
  - los tres retratos coinciden con su modelo;
  - lista, ficha lateral, páginas de empleado, centro de mando y móvil;
  - los 6 inactivos con su avatar dibujado;
  - 0 errores de consola.

## F. Seguridad

No se ha modificado el motor, los agentes, los prompts, las herramientas, los permisos, las aprobaciones, los presupuestos, Supabase, la base de datos, las migraciones, RLS, la autenticación (el proxy sigue igual), las variables, n8n, el CRM ni las misiones.

El paquete del navegador sigue sin prompts ni secretos.

## G. Archivos

- **Creados**:
  - `src/lib/agents/portraits.ts`
  - `public/avatars/equipo/{alex,marcus,sofia}.webp`
  - `scripts/models/retratos/{retrato.html,capturar.cjs,a-webp.mjs}`
  - `tests/portraits.test.ts`
  - `docs/FASE-432-AVATARES.md`
  - `docs/capturas-fase432/`
- **Modificados**:
  - `src/components/agent-avatar.tsx`
  - `src/components/office/office-view.tsx`
  - `src/app/(office)/empleados/[id]/page.tsx`
  - `next.config.ts` (solo caché de los retratos)
  - `public/models/equipo/LICENCIAS.md`
  - `docs/FASE-431-PERSONAJES.md` (estrategia contra clones)
