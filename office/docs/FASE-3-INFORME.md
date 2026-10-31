# Fase 3 · Informe final (etapas 2–7, todo en local)

- Commit inicial: `aa7b847`. Commits: `09590ab` (motor A–F + 0008), `fe805d8` (3D + Realtime) y el commit de este informe (centro de mando, pruebas de navegador, ajustes).
- **No hecho, por falta de autorización:** aplicar la 0008 en Supabase, publicar en Vercel, tocar variables, activar cron o workers, lanzar misiones, enviar comunicaciones o cambiar límites. Subir la rama a GitHub solo crea una vista previa protegida en Vercel; producción sigue en `01432bd`.

## Lo construido
1. **Motor A–F y migración 0008.** Ver `FASE-3-MOTOR.md`.
2. **Oficina 3D** (`src/components/office/office-3d.tsx`):
   - three 0.187.0, @react-three/fiber 9.8.2 y @react-three/drei 10.7.9, todo con versión fija.
   - Se carga en diferido y solo al elegir la vista 3D.
   - 9 personajes originales hechos con formas simples, sin modelos de terceros.
   - Cámara isométrica con giro y zoom limitados.
   - Cada estado real tiene su postura, su pantalla y su aro de color (`src/lib/office/scene.ts`).
   - Solo se mueven los estados en curso, sin aleatoriedad. En reposo no se redibuja nada: se midieron 0 llamadas de dibujo en 3 s.
   - Los 6 agentes fuera del piloto aparecen siempre inactivos.
   - La escena no tiene acciones: no llama al servidor ni a herramientas.
3. **Alternativa en lista:**
   - Es la vista por defecto en móvil, sin WebGL o con «reducir movimiento».
   - Un interruptor 3D/Lista guarda la preferencia.
   - Si falla WebGL durante el uso, la vista vuelve sola a la lista.
4. **Realtime** (`src/lib/office/sync.ts` y `use-office-sync.ts`):
   - Un solo canal para `agents`, `tasks`, `approvals` y `agent_runs`, con la sesión del administrador, así que respeta RLS.
   - Realtime solo avisa. El estado se relee siempre de Supabase con una acción de solo lectura (`refreshOffice`).
   - Los avisos se agrupan (300 ms).
   - Relee al conectar, al reconectar, al volver a la pestaña y al recuperar la red.
   - Una respuesta lenta nunca pisa una más reciente.
   - Al salir de la página se cierra la suscripción.
   - Indicador de conexión: en directo, reconectando o sin conexión, con un botón «Releer ahora».
5. **Ficha de agente** (en la oficina y en la lista):
   - Estado, detalle, departamento, modelo, tarea actual con enlace, pendientes y completadas, y último cambio.
   - Enlace al perfil del agente.
6. **Centro de mando** (`/centro`), con datos reales y solo lectura:
   - gasto del mes y límites;
   - encargos en marcha y encargos fallidos en 30 días;
   - aprobaciones pendientes con enlace al encargo;
   - número de fichas y documentos;
   - estado del equipo del piloto;
   - últimos encargos con su resultado (completada, con avisos, parcial o fallida), número de avisos y coste;
   - actividad reciente.

   No usa tablas de la 0008, así que funciona antes y después de aplicarla.

## Pruebas
- **Unitarias e integración:** 160 en verde (17 archivos), tipos limpios y build correcto. Nuevas en esta fase:
  - `fase3-engine` (14);
  - `migration-0008` (1, PostgreSQL real);
  - `office` (8: escena, elección de vista y sincronización con reconexión, desorden y limpieza).
- **Navegador** (`scripts/e2e-office.cjs`, 17 comprobaciones OK):
  - el escritorio abre en 3D;
  - sin redibujo en reposo;
  - 9 agentes, de ellos 6 inactivos;
  - ficha por clic y por teclado;
  - ficha de agente inactivo;
  - la preferencia de vista se recuerda;
  - sin errores de página;
  - el móvil abre en lista, sin scroll horizontal, y puede elegir 3D;
  - el centro de mando carga;
  - «reducir movimiento» abre en lista;
  - sin WebGL, lista con el botón 3D desactivado.
- **Capturas:** `docs/capturas-fase3/`.

## Rendimiento
- **JavaScript del 3D:** 252 KB comprimidos. Se descarga solo al abrir la vista 3D; la vista de la oficina sin 3D pesa 74 KB. Supera el objetivo de 200 KB del diseño; la mayor parte es three.js.
- **Medido en el contenedor** (modo desarrollo, GPU por software, peor que un equipo real):
  - lienzo dibujado en unos 1,7 s;
  - unos 27 fps al girar la cámara;
  - 28 MB de memoria JS.

  No se ha medido en un móvil físico.

## Seguridad
- **Claves:**
  - El código del navegador no contiene la clave secreta ni la de Anthropic. La única coincidencia es la librería de Supabase comprobando prefijos de clave.
  - La clave publicable se pasa en tiempo de ejecución solo al administrador.
- **La oficina solo lee.** Realtime y RLS solo dejan leer al administrador.
- **Permisos de la 0008:**
  - la interfaz pierde la escritura en `documents` y `task_dependencies`;
  - las funciones nuevas son solo para `service_role`;
  - no hay SECURITY DEFINER nuevas.
- **Vista previa sin login:** en producción está bloqueada y todo lleva a `/login`.
- **Sin cambios** en límites, permisos de herramientas, acciones externas ni ToolGateway.

## Pendiente y riesgos residuales
1. **Realtime con Supabase real no probado.** Necesita una sesión real; no hay Supabase local. La reconexión y la relectura están probadas con un canal simulado. La publicación de las tablas está en la 0008, y `agents`, `tasks`, `approvals` y `agent_runs` ya estaban publicadas.
2. **Peso del 3D:** 252 KB, por encima de los 200 KB del diseño.
3. **`zod` 4.3.3** tiene un aviso de seguridad alto (agotamiento de memoria). Ya estaba antes de esta fase. Se arregla actualizando a ≥ 4.6.6; recomendado.
4. **Control de coherencia (F):** busca frases concretas en el texto, así que puede no detectar una negación expresada con otras palabras.
5. **Las capturas no muestran estados reales en curso:** la vista previa local no tiene base de datos y los 3 agentes del piloto salen como «disponibles».
6. **Avisos en modo desarrollo:** drei muestra avisos de React («synchronously unmount a root») que no afectan al funcionamiento.

## Probar en local
```bash
cd office
npm install
npm run check                       # tipos + 160 pruebas
LOCAL_PREVIEW=1 NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY= ADMIN_EMAIL= npx next dev -p 3123
node scripts/e2e-office.cjs /tmp   # en otra terminal; guarda capturas en /tmp
```
Con `.env.local` completo (sin vaciar las variables), `npm run dev` usa Supabase real con inicio de sesión.

## Veredicto
**APTO CON CONDICIONES.** Las condiciones antes de producción son:
- aplicar la 0008 con autorización;
- comprobar Realtime en la vista previa con sesión real;
- decidir si se acepta el peso del 3D;
- actualizar `zod`.
