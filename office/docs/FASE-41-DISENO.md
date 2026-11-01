# Fase 4.1 · Rediseño estructural de la oficina 3D

Fecha: 01/11/2026. Solo es un cambio visual y local: no se ha publicado nada, no se ha desplegado en Vercel y no hay migraciones.

No se ha tocado nada de esto: motor, prompts, modelos, presupuestos, permisos, base de datos, migraciones, variables, autenticación, integraciones ni misiones.

## 1. Auditoría de la fase 4 (punto de partida)

| Problema | Causa |
|---|---|
| La oficina se veía pequeña y compacta | La planta era de unos 24 × 18 m, los puestos estaban pegados, no había pasillos y la cámara encuadraba toda la sede desde lejos |
| Los trabajadores eran diminutos y poco reconocibles | Las figuras eran de unos 1,2 m, con cabeza y cuerpo simples, sin ropa diferenciada ni manos, y la cámara estaba lejos |
| La escena se veía plana | No había mapa de reflejos ni sombras proyectadas, y había pocos materiales distintos |
| Sin arquitectura | Paredes bajas, sin ventanales, sin sala de reuniones real y sin despacho de dirección |
| Cámara | No había vista cercana ni accesos por departamento, y el acercamiento a un puesto era escaso |

## 2. Nueva distribución (planta de 40 × 30 m)

```
 ┌──────────────────── ventanal (fondo) ────────────────────┐
 │ Comercial (Marcus)     ┌─ Dirección (Alex) ─┐  Automat. │
 │                        │ despacho de vidrio │  (David)  │
 │ Marketing (Sofia)      └────────────────────┘           │
 │            ←pasillo→  ┌─ Sala de reuniones ─┐  Atención │
 │ Contenidos (Daniel)    │ 10 sillas, pantalla│  (Emma)   │
 │                        └────────────────────┘  Calidad  │
 │ Recepción   Creatividad (Lucia)  Finanzas (Oscar) (Victoria)│
 │                                             Zona descanso│
 └───────────────────────────────────────────────────────────┘
```

- **Pasillos**: de 4 m, con tiras de luz en el suelo y jardineras. Una prueba comprueba que hay al menos 3 m entre el ala oeste y la sala de reuniones.
- **Zonas por departamento**: moqueta propia, borde de luz del color del departamento y tótem con el nombre.
- **Dirección**: despacho acristalado sobre tarima de madera, con mesa ejecutiva en L, videowall de 3 pantallas, sofá, librería y la pared de marca HE Signal.
- **Sala de reuniones central**: vidrio en los 4 lados con puerta, mesa de roble de 5,2 m, 10 sillas, pantalla y lámparas lineales.
- **Otras zonas**: recepción con mostrador de marca, zona de descanso con sofá en L, punto de café y plantas.
- **Ventanales**: muro cortina con montantes cada 2,5 m y zócalo LED en los dos lados visibles.
- **Puestos**: mesas de 2,6 × 1,2 m (la ejecutiva de 3,4 m), monitores con brazo (dobles según el puesto), sillas ergonómicas con base de 5 radios y objetos propios de cada puesto: embudo y tótem de KPI en Comercial, armario de servidores en Automatización, tableta en Creatividad, etc.
- **Orientación**: todos los trabajadores miran a la cámara, para que se les vea la cara.

## 3. Trabajadores

- Cada uno tiene ropa propia: camisa, chaqueta, pantalón y zapatos. Alex, Oscar y Victoria llevan chaqueta, y Alex además corbata.
- La cara tiene ojos con iris y brillo, cejas, nariz, boca, orejas y mandíbula. Hay varios peinados con volumen.
- Brazos con hombro, brazo, antebrazo, mano y pulgar.
- Accesorios: gafas, cascos con micrófono, pendientes, reloj y la acreditación naranja de HE Signal.
- La escala es legible desde la vista isométrica: el conjunto de silla y figura es un 20 % mayor que en la fase 4.
- **Los estados siguen siendo solo los reales**:
  - Alex, Marcus y Sofia, en el piloto, se ven en color con su estado real.
  - Los otros 6 aparecen en gris, con la pantalla apagada y la etiqueta «Inactivo», sin animaciones.
  - No se inventa actividad. Las animaciones (escribir, pensar, leer…) solo salen del estado guardado (`sceneLook`).

## 4. Cámara y controles

- **Vista cercana** (inicial): la zona de trabajo, con los trabajadores visibles. En móvil arranca sobre Alex, Marcus y Sofia.
- **Vista general**: toda la sede.
- **Accesos por departamento**: una fila de botones con el nombre del agente y su departamento. El punto verde marca a los del piloto. Al pulsar uno, la cámara se acerca al puesto y se abre la ficha. En escritorio el puesto queda a la izquierda de la ficha.
- **En móvil**, al abrir la ficha la escena sube para que el puesto siga visible encima.
- **Controles**: transiciones suaves que se cortan si el usuario toca la cámara, giro limitado y desplazamiento que no sale de la planta. Con «reducir movimiento», los cambios son sin animación.

## 5. Iluminación y materiales

- **Mapa de reflejos generado en el navegador** (`RoomEnvironment` + PMREM, sin descargas): reflejos en el suelo de microcemento pulido, el vidrio y el metal.
- **Luces**: una luz principal cálida con sombras reales, una luz fría de relleno desde los ventanales y luz ambiental suave.
- **Sombras**: se calculan **una sola vez** y solo se rehacen si cambia una postura o pantalla, nunca en cada fotograma. Además se mantienen las sombras de contacto.
- **Materiales**: microcemento con juntas y variación, roble, metal, tela, vidrio y pantallas emisivas.

## 6. Rendimiento

| Métrica | Fase 4 | Fase 4.1 |
|---|---|---|
| Llamadas de dibujo | 130 | 223 |
| Triángulos | ~22.000 | ~155.000 |
| Dibujo en reposo | 0 (`frameloop="demand"`) | 0 (sin cambios) |
| Tiempo por fotograma, GPU por software (SwiftShader) | 92 ms | 272 ms (calidad baja) / 460 ms (alta) |
| Paquete 3D (carga diferida) | — | 267 KB comprimido |

- **Calidad automática**: al abrir, se mide una sola vez lo que tarda un fotograma. Si pasa de 40 ms, la escena cambia a **calidad baja**: sin mapa de reflejos ni sombras proyectadas, con más luz ambiental y resolución 1x.
  - En una GPU real, el fotograma completo está muy por debajo de ese umbral.
  - En un ordenador sin aceleración, la vista sigue funcionando, aunque a pocos fotogramas por segundo mientras se gira.
  - `?calidad=alta` o `?calidad=baja` fija la calidad a mano.
- **Optimizaciones que se mantienen**:
  - mobiliario fusionado por material;
  - una caja de clic por puesto;
  - sin `backdrop-blur` en las etiquetas.
- **Optimización nueva**: cajas redondeadas con pocas subdivisiones (−30 % de triángulos).
- **Alternativa sin WebGL**: la vista de lista, igual que antes. Las pruebas cubren la lista sin WebGL, con «reducir movimiento» y en móvil.

## 7. Pruebas

- `tsc`: sin errores.
- Vitest: **170/170**, incluidas la de distribución (solapes, pasillos, despacho ejecutivo) y la de separación del catálogo público.
- Navegador (`scripts/e2e-office.cjs`): **17/17**.
  - Ahora espera a que termine la medición de calidad antes de comprobar que no se redibuja en reposo.
- `next build`: OK.
- Paquete del navegador revisado: sin prompts, sin claves y sin `__officeCamera` (solo existe en desarrollo).
- Clic sobre un puesto en la escena: abre su ficha (comprobado con Sofia).

## 8. Capturas

Las capturas están en `docs/capturas-fase41/`:

- `00-antes-despues-*.png`: comparación con `docs/capturas-fase4/`;
- `01`, `02`: vista cercana y vista general;
- `03`–`07`: Alex, Marcus y Sofia, y Daniel y David inactivos;
- `08`: calidad baja;
- `09`, `10`: móvil, con la ficha de Marcus en la `10`.

## 9. Límites de la arquitectura actual y propuesta

Los personajes se generan con código, a partir de formas geométricas simples. El salto respecto a la fase 4 es grande, pero tiene un techo:

- no hay caras con textura ni pelo realista;
- no hay ropa con pliegues;
- no hay animación con esqueleto.

**Propuesta para un acabado de nivel comercial**:

1. Modelos glTF hechos en Blender, o con licencia CC0 / comercial (cuidado con imitar productos o marcas existentes):
   - personajes estilizados con esqueleto y animaciones (sentado, escribiendo, pensando);
   - mobiliario de mejor calidad.
2. Compresión Draco/Meshopt y texturas KTX2, cargadas en diferido por zona.
3. Iluminación precalculada (*lightmaps*) del mobiliario fijo, para tener luz y sombras de calidad casi sin coste en el navegador.
4. Se mantiene todo lo demás: R3F, la cámara, los estados reales y la alternativa en lista.

Necesita decidir de dónde salen los modelos (encargo o licencia) y unos 2–4 días de integración.

## 10. Archivos modificados

| Archivo | Cambio |
|---|---|
| `src/lib/office/layout.ts` | Planta 40 × 30, zonas, sala de reuniones, zona de descanso y accesos rápidos |
| `src/components/office/scene/character.tsx` | Trabajadores nuevos (ropa, cara, manos, accesorios) |
| `src/components/office/scene/workstation.tsx` | Puestos, zonas, despacho acristalado, objetos de cada puesto |
| `src/components/office/scene/environment.tsx` | Arquitectura: ventanales, sala de reuniones, recepción, zona de descanso, pasillos |
| `src/components/office/scene/textures.ts` | Microcemento y carteles de departamento |
| `src/components/office/scene/rounded.tsx` | Nuevo: caja redondeada ligera |
| `src/components/office/office-3d.tsx` | Mapa de reflejos, sombras estáticas, calidad automática, vista cercana y general, acercamiento a cada puesto |
| `src/components/office/office-view.tsx` | Botones de encuadre, accesos por departamento, ajuste en móvil |
| `tests/office-layout.test.ts` | Prueba de pasillos, zona de descanso y despacho ejecutivo |
| `scripts/e2e-office.cjs` | Espera a la medición de calidad |
| `docs/capturas-fase41/*` | Capturas |

## 11. Riesgos

- **Equipos sin GPU o muy antiguos**: la vista pasa a calidad baja. Si aun así va lenta, la lista sigue disponible y se recuerda la preferencia.
- **Medición al abrir**: dibuja la escena 3 veces de golpe, una sola vez (≈1 s de bloqueo como mucho en un equipo lento).
- **La vista previa de Vercel usa la base de datos de producción**: si se publica una vista previa, no hay que crear encargos en ella.
- **Producción**: no ha cambiado; sigue en `500245f`.
