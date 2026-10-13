# Chatbot de muestra · HE Signal

Demo publicada: https://claude.ai/artifact/9miHZrNaTiWPTJTfsaEWDf (privada; se comparte desde el menú «Compartir»).
Archivo: `demo-chatbot.html`.

## Qué hace
- Simula un WhatsApp de **Academia Lumen** (centro ficticio, marcado como demo).
- Responde **solo** con la «Ficha del centro»; si algo no está en la ficha, avisa al equipo en vez de inventar.
- Ofrece huecos para la clase de prueba y registra la reserva en «Lo que recibe el centro».
- Si se pide una persona, o la pregunta no está en la ficha, crea un «Aviso».
- La ficha es editable: antes de una llamada se pegan los datos reales del centro del cliente.
- Con IA (Claude) cuando se abre desde claude.ai; si no, usa respuestas guionizadas con la misma ficha.

## Base para los clientes reales (Make + Claude + API de Meta)
El prompt `RULES` y el formato de la ficha del HTML son la plantilla del sistema real:
1. Webhook de WhatsApp/Instagram (Meta) → escenario de Make.
2. Make llama a Claude con `RULES` + ficha del cliente + últimos mensajes y pide el JSON `{reply, action, lead}`.
3. `action`: `offer_slots` → enlace o huecos del calendario del centro · `handoff` → aviso al dueño y bot en pausa en esa conversación.
4. Se responde por la API de Meta con `reply`.
