# Fase 4 · Rediseño visual de la oficina 3D y de la interfaz

Estado: **implementado y probado en local, sin desplegar.**
- Commit de partida: `500245f`, la versión en producción.
- Sin cambios en el motor, en Supabase, en los permisos ni en los límites.
- No se han ejecutado agentes ni misiones.

## Dirección artística
«Estudio tecnológico nocturno»:
- carcasa azul marino, suelo de madera oscura en lamas y mesas de madera cálida con patas metálicas;
- pantallas emisivas y el naranja de HE Signal como detalle;
- isométrica estilizada: sin aspecto infantil ni ciencia ficción.

## Distribución (`src/lib/office/layout.ts`)
- **Fondo:** despacho de dirección acristalado (Alex), con pantalla de pared, sofá, estantería y planta.
- **Ala izquierda:** Comercial (Marcus, pantalla doble, teléfono, panel de embudo), Marketing (Sofia, tablero de campañas) y Contenidos (Daniel, estantería, papeles, flexo).
- **Frente:** Creatividad (Lucía, tableta gráfica y moodboard) y Finanzas (Oscar, archivador y gráficas).
- **Ala derecha:** Automatización (David, triple monitor y armario de servidores), Atención (Emma, soporte de cascos y teléfono) y Calidad (Victoria, panel de checklist).
- **Centro:** sala de reuniones con mesa ovalada, 8 sillas, lámparas colgantes y alfombra de marca.
- **Arquitectura:** ventanales nocturnos, muro «HE SIGNAL · IA · CHATBOTS · MARKETING», separadores de vidrio con jardinera, plantas y punto de café.
- **Independiente del seed:** esta distribución no toca `agents.desk` del registro, que se vuelca a la base de datos.
- **Texturas** (pantallas, muro, ventanales, suelo y alfombra): se dibujan en el navegador, sin imágenes externas.

## Personajes y estados (`scene/character.tsx`)
- Silueta propia por agente: torso con detalle de color, piernas sentadas, manos, ojos, peinado y accesorio (gafas, cascos, pendiente).
- **La animación depende solo de `agents.status`:**
  - trabajando: tecleo;
  - pensando: mano a la barbilla y puntos;
  - leyendo o revisando: mirada sobre la pantalla;
  - esperando aprobación: marca naranja;
  - esperando a otro agente: reloj de arena;
  - completado: aro verde;
  - error: pantalla y aro rojos.
- Sin temporizadores ni estados inventados.
- **Inactivos** (fuera del piloto): figura apagada, pantalla apagada y servidores sin luces, aunque su fila diga otra cosa.

## Cámara (`office-3d.tsx`)
- **Escritorio:** isométrica (azimut 45°, unos 34° de elevación).
- **Móvil vertical:** vista lateral en diagonal ligera, para que la planta ocupe el ancho.
- **Encuadre automático** calculado con la proyección real de la planta.
- **Al seleccionar un empleado:** acercamiento suave a su puesto (inmediato con «reducir movimiento»), con el puesto a la izquierda de la ficha en escritorio. El botón «Ver toda la oficina» vuelve al encuadre general.
- **Controles:** giro y zoom limitados, con amortiguación. Desplazamiento limitado a la planta. Táctil: un dedo gira y dos dedos acercan o desplazan.

## Interfaz
- **Oficina:**
  - cabecera con estado de conexión e indicadores (en el piloto, trabajando ahora, inactivos);
  - selector 3D/Lista con iconos;
  - ficha premium con estado, función y responsabilidades, trabajo (pendientes, completadas, modelo, tarea actual, tareas abiertas) y actividad reciente.
- **Datos reales de la ficha:**
  - la descripción y las responsabilidades llegan desde el servidor;
  - las tareas y la actividad las da la acción de solo lectura `agentDetail`, que reutiliza la consulta del perfil del agente, con RLS.
- **Escritorio:** panel lateral. **Móvil:** hoja inferior.
- **Navegación:** iconos propios de trazo fino, elemento activo con acento cobalto y barra inferior con iconos.
- **Sistema visual:** tarjetas con fondo translúcido y contorno sutil (sin bordes grises) en Oficina, Centro de mando, Encargos, perfiles, Configuración e inicio de sesión. Fondo con degradados suaves.

## Seguridad: corrección hecha durante la fase
- **Problema:** el código del navegador incluía el registro completo de agentes con sus instrucciones internas (prompts). Ya pasaba en la versión de producción.
- **Corrección:** lo público (departamentos, modelos, avatares, agentes del piloto) se separa en `src/lib/agents/catalog.ts`. `registry.ts` lo reexporta, así que el servidor y el motor no cambian.
- **Prueba nueva:** `tests/client-boundary.test.ts` impide que un módulo de cliente vuelva a importar el registro.
- **Verificado en el código compilado:** 0 apariciones de las instrucciones, 0 secretos y 0 restos de depuración.

## Rendimiento
- **Fusión del mobiliario estático** en una malla por material (`scene/baked.tsx`):
  - de 636 a 130 llamadas de dibujo por fotograma, con 22.000 triángulos;
  - pantallas, personajes activos, marcas de estado y selección quedan fuera de la fusión y responden al estado real.
- **Clics y puntero:** una caja invisible por puesto, de modo que el puntero solo se comprueba contra 9 cajas.
- **Coste por fotograma:**
  - sin `backdrop-blur` sobre el lienzo;
  - zonas opacas con el color mezclado;
  - resolución máxima 1,5×;
  - bucle de dibujo solo cuando hay actividad real (0 dibujos en reposo);
  - sombras de contacto calculadas una vez.
- **Paquete 3D:** 209 KB con Brotli (255 KB gzip), frente a 201 KB antes del rediseño. Carga diferida y alternativa en lista.
- **Medido con GPU por software** (Chromium sin GPU, modo desarrollo):
  - 4,7 ms de JavaScript por fotograma;
  - unos 12 fps al girar, el techo de este entorno;
  - lienzo dibujado en unos 3,3 s.
- **Limitación:** no se ha medido en una GPU real ni en un móvil físico.

## Pruebas
- **Automáticas:** 169/169 en 20 archivos. Nuevas: `office-layout` (3) y `client-boundary` (1).
- **TypeScript** limpio y **build** de producción correcto.
- **Navegador:** 17/17 comprobaciones (`scripts/e2e-office.cjs`), más clic directo sobre la escena (abre la ficha de Victoria).
- **Capturas:** `docs/capturas-fase4/`.

## Limitaciones
- La vista previa local no tiene base de datos: todos los agentes del piloto salen «disponibles». Las poses de trabajo, pensando, etc., están cubiertas por las pruebas del mapeo estado → escena y se verán en producción con datos reales.
- No medido en una GPU real ni en un móvil físico.
- Encargos y Configuración solo han recibido el nuevo estilo de tarjetas, sin rediseño completo.
