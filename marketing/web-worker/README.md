# IA real para la demo de hesignalagency.com/demo (opcional)

Sin esto, la demo funciona igual con respuestas preparadas (gratis, sin servidor).
Con esto, contesta Claude de verdad, como en la demo de Vallès Jiu Jitsu. Si el Worker falla, la web vuelve sola al modo preparado.

## Coste
Se paga por uso a Anthropic. Con el modelo configurado (`claude-opus-5-5`, esfuerzo bajo), una conversación de unos 10 mensajes cuesta del orden de 0,10–0,25 $. Con `claude-haiku-5-5` (cambiar la constante `MODELO`) sería mucho menos, a cambio de respuestas algo menos finas. Pon un **límite de gasto mensual** en la consola de Anthropic (Settings → Limits).

## Pasos (unos 10 minutos, desde el ordenador)
1. **Clave de API**: entra en console.anthropic.com → API Keys → Create Key. Cópiala.
2. **Crear el Worker**: en Cloudflare → Workers & Pages → Create → Worker → nombre `hesignal-demo` → Deploy.
3. **Pegar el código**: «Edit code», borra lo que hay, pega todo `chat-worker.js` y pulsa Deploy.
4. **Guardar la clave**: en el Worker → Settings → Variables and Secrets → Add → tipo *Secret*, nombre `ANTHROPIC_API_KEY`, valor tu clave → Deploy.
5. **Pásame la URL** del Worker (algo como `https://hesignal-demo.TU-SUBDOMINIO.workers.dev`). Yo la pongo en `assets/demo.js` (`API_URL = '…/chat'`) y te paso la web para subir.

Seguridad: el Worker solo acepta peticiones desde hesignalagency.com, limita los mensajes por IP y no guarda nada.
