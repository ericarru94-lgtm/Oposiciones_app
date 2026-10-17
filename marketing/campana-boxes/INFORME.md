# Auditoría de captación HE Signal · 17/10/2026

Qué he revisado de verdad: las 8 páginas públicas de hesignalagency.com (inicio, servicios, precios, nosotros, contacto, agendar, gracias, blog) con su HTML; el perfil público de @hesignalagency; las métricas de Instagram y la cola de publicaciones en **Metricool**; los envíos del formulario de la web en el **Gmail** de la agencia; y la hoja de prospección y los guiones del repositorio.
Qué **no** he podido ver: los DMs de Instagram, el WhatsApp de la agencia, las estadísticas de visitas de la web (Cloudflare) y los resultados de las pruebas de «cliente misterioso» que empezaste el 13/10 (la hoja del repositorio sigue vacía). No he publicado nada, no he contactado con nadie y no he tocado precios.

---

## 1 · Problemas detectados, con su evidencia

| # | Problema | Evidencia | Gravedad |
|---|---|---|---|
| 1 | **Un posible cliente se quedó sin respuesta.** | En Gmail hay 4 envíos del formulario. Tres parecen pruebas tuyas, pero el del **7/9 a las 9:07** es «Hugo Palacios», gimnasio, reto «Responder a tiempo». No hay ninguna respuesta a su email en ese Gmail. Si no le contestaste desde otro sitio, es el único lead que ha entrado y se ha perdido. | Alta (hoy) |
| 2 | **«Agendar» no agenda.** El botón principal («Agendar sesión gratuita de 30 min») lleva a un formulario que pide reto, tipo de centro, nombre y email, **sin teléfono**, y promete «os contactamos en menos de 24h». | HTML de /agendar (Web3Forms) y /gracias. Vendes «respuesta al instante» y haces esperar 24 h a tu propio cliente. El botón de WhatsApp solo está en el pie de página y sin mensaje precargado. | Alta |
| 3 | **Los reels de la semana 2 no se publicaron.** | Metricool: los del 14/10 y 16/10 dan **ERROR** («la cuenta no cumple el requisito de seguidores para reels de prueba»). El del domingo 18/10 está en cola con el mismo tipo y fallará igual. | Alta |
| 4 | **Instagram no tiene alcance todavía.** | 0 seguidores, 60 seguidos. El mejor reel (11/10): 111 reproducciones, 102 cuentas, **2,0 s de visionado medio** y solo un 10,8 % pasó de 3 s: se mostró, pero la gente pasó de largo en el primer segundo. Los carruseles: 0 alcance registrado. | Media |
| 5 | **Oferta y mensaje demasiado anchos.** | La web habla de 3 nichos (y restaurantes en servicios/precios), 5 servicios + pack, y de tres zonas distintas: «Barcelona» (título, nosotros, bio de IG), «Rubí y el Vallès» (pie, servicios, precios) y «toda España». La lista de prospección es de Barcelona ciudad. | Media |
| 6 | **Un dato no demostrable.** | El Pack Captación lleva la etiqueta «**El más elegido**» sin tener clientes. Va contra lo que dice tu página Nosotros («no os vamos a vender casos inflados»). | Media |
| 7 | **Contradicciones pequeñas que restan confianza.** | Plazo: «unos días» (contacto y proceso) frente a «entre 1 y 2 semanas» (FAQ). Contacto dice que «el mantenimiento mensual es opcional»; precios lo incluye como parte del asistente (89 €/mes). Los chats de ejemplo («Gimnasio Yara», «Academia Vértice») no dicen que son de demostración. | Baja |
| 8 | **La oferta piloto no está en la web.** | «3 plazas piloto con precio de lanzamiento» solo aparece en un carrusel de Instagram con 0 alcance. En la web, la primera compra posible son 590 € + IVA. | Media |

**Lo que funciona y hay que conservar:** el titular «Ni una consulta se queda sin respuesta» (habla del problema, no de la tecnología); los precios publicados y sin permanencia; las FAQ honestas (no se inventa nada, lo delicado va a una persona, dice que es un asistente); la página Nosotros; el chat animado del inicio; y el método «cliente misterioso», que es lo más diferencial que tenéis.

---

## 2 · Hipótesis: qué dicen los datos

| Hipótesis | Veredicto | Por qué |
|---|---|---|
| La oferta es demasiado amplia | **Indicios a favor, sin confirmar** | Problema 5. Pero nadie ha dicho «no» por eso todavía: no hay conversaciones registradas. |
| El prospecto no entiende el retorno | **Sin datos** | La web no tiene ni un número de retorno. Hace falta oírlo en llamadas (experimento, sección 8). |
| La demo enseña tecnología, no urgencia | **Sin datos** | No me consta ninguna demo hecha. ¿Cuántas has hecho y a quién? Si la respuesta es cero, el cuello de botella está antes. |
| El proceso no cierra la siguiente acción | **Confirmado en la web** | Problemas 1 y 2: el formulario no cierra fecha y el único lead no tiene respuesta registrada. En llamadas: sin datos. |
| Instagram no tiene prueba ni diferenciación | **Indicios a favor** | 0 seguidores, ningún caso, chats de ejemplo sin etiquetar. Pero con 0 alcance, el contenido no es lo que frena las ventas ahora. |

**Conclusión honesta:** con 0 conversaciones de venta registradas, todavía no se puede saber por qué no se cierra. Lo que sí se sabe es que **no está entrando casi nadie al embudo** y que el poco que entra (la web) se encuentra fricción. El trabajo de 30 días es meter 30 boxes en el embudo y medir dónde se caen.

---

## 3 · Tres cambios para la web (solo tres)

1. **Que «Agendar» agende de verdad, y al momento.** Sustituir el formulario por un calendario real (Google Calendar «Agenda de citas» o Cal.com, ambos gratis) y poner encima un botón «**Pruébalo ahora en WhatsApp**» con mensaje precargado (`https://wa.me/34623976145?text=Hola,%20quiero%20ver%20cómo%20funciona%20el%20asistente`). Si tu propio WhatsApp contesta al momento con el asistente, es la mejor demo posible. Si se mantiene el formulario, añadir campo de teléfono/WhatsApp. Añadir también un botón flotante de WhatsApp en móvil.
2. **Una página para un solo nicho: `/boxes`.** Titular: «Que ninguna clase de prueba se pierda por contestar tarde». El chat de ejemplo (etiquetado «conversación de demostración»), el cálculo de la pieza 3 y la **oferta piloto** con sus condiciones. Esta es la página que se enlaza en la bio y en los DMs durante la campaña. Sin tocar el resto de la web.
3. **Coherencia y honestidad.** Quitar «El más elegido» del pack (o cambiarlo por «El más completo»); elegir una sola ubicación (recomiendo «Barcelona y el Vallès»); quitar «restaurantes»; unificar el plazo («en marcha en 7 días») y aclarar que la cuota mensual del asistente no es opcional; etiquetar los chats como demostración.

(No he cambiado nada: la web no está en el repositorio. Si me pasas la carpeta en .zip, hago los tres cambios y te la devuelvo lista para subir.)

---

## 4 · Nicho recomendado: boxes de CrossFit / cross training y gimnasios de clases dirigidas en Barcelona

Argumentos:
- **Su venta es la clase de prueba**, y es justo lo que el asistente hace (reservar). La demo se entiende en 10 segundos.
- **Calendario:** enero es la temporada fuerte de altas en gimnasios. Montarlo en noviembre es el argumento de urgencia («tenerlo listo antes de enero»). Las academias ya pasaron su pico de septiembre.
- **Retorno fácil de explicar:** las cuotas publicadas de boxes de Barcelona van de 60 a 115 €/mes (p. ej. HOW desde 85 €, SAB 82 €, WeZone 95 €). Un socio al mes paga el asistente.
- **Decide el dueño**, que suele ser también coach: una sola conversación, sin comités.
- **Viven en Instagram** (la clase de prueba se pide por DM), así que el piloto puede empezar por Instagram, que es más fácil de conectar que la API de WhatsApp.
- **Ya tienes la lista empezada:** 12 de los 30 centros de la hoja son boxes, gimnasios boutique y pilates. Y el único reel que funcionó era de gimnasio.
- En contra: ticket más bajo que una autoescuela y la decisión puede ser rápida pero también impulsiva. Por eso las autoescuelas quedan como **plan B** si en 2 semanas los boxes no responden.

Para 30 días hacen falta unos 40 boxes. Faltan unos 28: búscalos en Google Maps («crossfit», «cross training», «box» en Barcelona) y apúntalos en la hoja.

---

## 5 · Oferta de entrada (propuesta, la decides tú)

**Piloto «Clase de prueba» · 30 días · solo 3 boxes**
- **Qué incluye:** asistente en **un canal** (Instagram DM o WhatsApp, el que más use el box), hasta 15 preguntas frecuentes, reserva de la clase de prueba, aviso al coach y paso a una persona en lesiones, pagos y quejas. Informe al día 30: mensajes contestados fuera de horario y clases reservadas.
- **Precio piloto:** 0 € de alta + **149 € + IVA** el mes de piloto.
- **Garantía:** si en 30 días no ha reservado ni una clase de prueba, se devuelven los 149 €.
- **Al terminar:** si sigue, alta reducida de 295 € (la mitad de 590 €) + 89 €/mes, sin permanencia. Si no, se apaga y ya está.
- **A cambio:** permiso para contar el resultado (anónimo si lo prefiere) y una opinión sincera.

Por qué así: baja la primera decisión de 590 € a 149 € con riesgo cero, mantiene los precios de la web intactos para después y te da lo que más te falta: **un caso real con números**. Riesgo: el montaje te cuesta horas; por eso son solo 3 plazas y un solo canal.

---

## 6 · Campaña de 30 días (19/10 → 17/11)

Objetivo: **1 piloto firmado**. Indicadores: 40 tests hechos, 40 DMs con resultado, 10 demos, 3 propuestas.

| Semana | Prospección (lo importante) | Instagram | Web |
|---|---|---|---|
| **1 · 19–25/10** | Completar la lista a 40 boxes. 15 tests de cliente misterioso (mar–jue noche). 10 DMs con resultado. Contestar a Hugo Palacios. | Pieza 1 (dom), pieza 2 (mar), pieza 3 (jue), pieza 4 (sáb). Republicar como reel normal el del 18/10. | Cambio 1 (calendario + WhatsApp) |
| **2 · 26/10–1/11** | 15 tests más, 15 DMs, seguimientos día 3. Primeras demos. | Pieza 5 con los datos reales de los tests. 2 reels más del mismo estilo. | Cambio 2 (`/boxes`) y 3 |
| **3 · 2–8/11** | 10 tests más, demos, propuestas. Visitar en persona 5 boxes que no contestan DMs. | 2 reels. Si hay piloto: reel «montando el asistente de un box» (con permiso). | — |
| **4 · 9–17/11** | Seguimientos día 7, cerrar pilotos. Revisión del experimento. | 2 reels con lo aprendido. | Añadir el primer caso si lo hay |

Tiempo estimado: 1 h al día de prospección (de noche, los tests) + 2 h a la semana de contenido.

---

## 7 · Demo, guion comercial y seguimiento
Están completos en `GUION-COMERCIAL.md`: DM con el resultado del test, 5 preguntas de diagnóstico con el cálculo, demo de 2:30 en el móvil del dueño (problema → demo con sus datos → número → cierre con fecha) y 3 mensajes de seguimiento (día 1 resumen, día 3 pregunta A/B/C/D, día 7 cierre).
**Requisito:** que el chatbot de muestra funcione (está pendiente en otro chat). Sin él, la demo se hace con la pieza 2, que es más floja.

---

## 8 · Experimento: saber por qué no se cierra

Con 30–40 boxes no hay estadística fina: el objetivo es ver **en qué paso se cae la gente** y **por qué**.

1. **Embudo con 5 pasos** en la hoja (columna «Estado»): Test hecho → DM enviado → Respondió → Demo hecha → Propuesta → Cliente. Y una columna nueva **«Motivo de pérdida»** con 5 opciones fijas: no responde · no ve el problema · precio · tiempo/montaje · confianza («sois nuevos»).
2. **Dos variantes de oferta, alternas por orden de la lista** (impares A, pares B):
   - A: precios de la web (590 € + 89 €/mes).
   - B: piloto 149 € con garantía.
3. **Umbrales para decidir** (son objetivos propios, no datos del sector):
   - Menos de 4 de cada 20 DMs responden → el problema es el **mensaje o el canal**: probar llamada o visita.
   - Responden pero no aceptan demo → **no ven el problema**: enseñar su tiempo de respuesta con más contraste (pieza 5).
   - Demo pero no propuesta → la **demo** no conecta: revisar si el número lo dijo el dueño.
   - Propuesta pero no cierre → **oferta o confianza**: comparar A frente a B y leer los motivos.
4. **Revisión el 2/11 y el 17/11.** Mándame la hoja y te devuelvo el diagnóstico.

---

## 9 · Publicidad: recomendación y presupuesto máximo

**No invertir ahora.** Con 0 seguidores, sin caso y sin oferta validada, cualquier euro compra reproducciones de gente que entrena, no de dueños de box. El dinero rinde más en gasolina para visitar boxes.

Si en la semana 3 ya hay al menos 5 demos hechas: **prueba de 50 € como máximo** (5 €/día, 10 días), promocionando el reel que mejor retención tenga, objetivo «mensajes», Barcelona, 25–50 años. Se para en cuanto gastes 25 € sin ninguna conversación con un box. **Tope de los 30 días: 50 €.**
