# Fase 2 · Diseño técnico de la oficina 3D

Estado: diseño aprobado internamente, **sin construir**. Se implementa cuando confirmes.

## Dependencias

| Paquete | Versión | Motivo |
|---|---|---|
| `three` | 0.187.0 | Motor 3D |
| `@react-three/fiber` | 9.8.2 | Three.js con React (compatible con React 19.3) |
| `@react-three/drei` | 10.7.9 | Cámara ortográfica, controles, `Html`, `ContactShadows`, `Bvh` |
| `@types/three` | 0.186.0 | Tipos |

Sin modelos externos al principio: los personajes y muebles se generan con geometrías simples (low-poly) → sin licencias de terceros, sin descargas pesadas y personajes 100 % originales. Coste: 0 €.

## Arquitectura

```
app/(office)/page.tsx (servidor)
 ├─ listAgents()  → estado inicial real (Supabase)
 └─ <OfficeView initial=…>            (cliente)
     ├─ useOfficeRealtime()           Supabase Realtime: agents, agent_runs, approvals (RLS: solo admin)
     ├─ ¿3D posible? (WebGL, ancho ≥ 768 px, sin «reducir movimiento», preferencia guardada)
     │    sí → <Office3D/>  (next/dynamic, ssr: false, carga diferida)
     │    no → <AgentList/> (la vista actual)
     └─ <AgentPanel/>                 ficha lateral al seleccionar
```

La escena **no tiene lógica de negocio**: recibe `AgentWithState[]` y dibuja. Cada estado viene de la base de datos (`agents.status`, escrito solo por el motor). Ninguna animación usa números aleatorios: todas son funciones del tiempo y del estado.

### Componentes 3D

- `Office3D`: `<Canvas frameloop="demand" dpr={[1, 1.5]}>`, cámara **ortográfica isométrica** (rotación 45°, elevación 35,26°), `OrbitControls` con zoom y desplazamiento limitados y giro restringido.
- `Floor` + `Zone` por departamento (alfombra con el color del departamento y rótulo).
- `Desk` (mesa, silla, monitor con pantalla emisiva) reutilizando geometrías y materiales compartidos; instanciado.
- `MeetingRoom`: mesa ovalada con 9 sillas y pantalla; se ilumina cuando hay una reunión activa (fase 3).
- `Character` (uno por agente, a partir de `AvatarSpec`).
- `StatusBadge3D`: indicador sobre la cabeza (`Html` de drei con el mismo `StatusBadge`), y tarea actual al pasar el ratón.
- Decoración ligera: plantas, estanterías, pantalla de marca con «IA · CHATBOTS · MARKETING».

### Personajes originales low-poly

Construidos con primitivas y sombreado plano (`flatShading`):
cuerpo en cápsula con el color de vestuario, cabeza icosaédrica con el tono de piel, 8 peinados como mallas propias (corto, rapado, rizado, moño, largo, coleta, ondulado, raya al lado) y accesorios (gafas, auriculares, pendiente, reloj). Proporciones propias de HE Signal (cabeza grande, cuerpo compacto). Paleta: negro, blanco y azul cobalto, con el naranja de la marca como detalle (por ejemplo, el punto de señal en la placa de cada escritorio). Ningún personaje imita personajes, mascotas ni estilos de franquicias existentes.

### Animaciones por estado (reutilizables)

| Estado | Animación |
|---|---|
| Disponible | respiración suave, pantalla en reposo |
| Trabajando | tecleo (brazos), pantalla con líneas que avanzan |
| Pensando | mano en la barbilla, tres puntos sobre la cabeza |
| En revisión | sostiene una hoja, marca de verificación parpadeante |
| Bloqueado | cabeza baja, aro rojo y aviso «Esperando tu aprobación» |
| Completado | gesto de estiramiento y marca verde unos segundos |

Una sola función `useStateAnimation(status)` por personaje; transiciones de 300 ms entre estados.

## Rendimiento

- `frameloop="demand"`: solo se redibuja cuando hay animación visible o cambia un estado (`invalidate()`), y se detiene si la pestaña está oculta.
- Geometrías y materiales compartidos, mallas de muebles instanciadas, sin sombras dinámicas (una `ContactShadows` estática), `dpr` máximo 1,5.
- La escena se carga solo en la página de la oficina; objetivo < 200 KB comprimidos de JavaScript adicional.
- Objetivo: 60 fps en un portátil normal y < 2 s hasta interactuar.

## Alternativa en lista (móvil y equipos modestos)

La vista en lista actual se mantiene y es la predeterminada en pantallas pequeñas, sin WebGL o con «reducir movimiento». Un interruptor «3D / Lista» guarda la preferencia en el navegador.

## Accesibilidad

Cada personaje es seleccionable con teclado; la lista sigue siendo la referencia para lectores de pantalla; los colores de estado van siempre acompañados de texto.

## Pruebas de la fase 2

Unitarias del mapeo estado → animación y del selector 3D/lista; Playwright en escritorio (captura de la escena, selección de un agente y apertura de su ficha) y en móvil (cae en lista); rendimiento medido con el panel de rendimiento del navegador.
