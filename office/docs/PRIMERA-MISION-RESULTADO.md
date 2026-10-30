# Primera misión real · resultado (30/10/2026)

Encargo: estudio comercial de gimnasios en Barcelona. 15:09–15:12 UTC. Datos de Supabase.

| Agente | Resultado | Llamadas | Coste real | Reservado (máx.) |
|---|---|---|---|---|
| Alex (planificación) | Delegó en Marcus y Sofia | 4 | 0,042 $ | 0,089–0,097 $ cada una |
| Marcus | 5 fichas reales en el CRM con URL; tarea detenida: «límite de gasto de la misión» | 3 | 0,216 $ | 0,30 · 0,32 · 0,53 $ |
| Sofia | Fallida: «respuesta cortada por longitud» (8.000/8.000 tokens de salida) | 2 | 0,005 $ | 0,004–0,005 $ |
| Alex (síntesis) | Informe honesto pero con un error: «no hay empresas» | 1 | 0,027 $ | 0,092 $ |
| **Total** | | **10** | **0,2897 $** (Claude 0,2797 · búsquedas 0,01) | |

Sin sobrecostes, sin llamadas inciertas, sin acciones externas. 1 búsqueda de 15. Una ficha rechazada por teléfono de más de 40 caracteres (reintentada bien) y un duplicado evitado.

## Causas
1. **Reserva demasiado conservadora**: el coste real fue un 6–15 % de lo reservado (sobre todo por suponer 3 pasadas sin caché del contexto completo). Con 0,26 $ gastados, la siguiente reserva de Marcus (≈0,53 $) no cabía en los 0,75 $ de las subtareas y se paró a mitad.
2. **Salida máxima de 8.000 tokens para Sofia** (Haiku con esfuerzo alto: el pensamiento cuenta como salida).
3. **Alex y Sofia solo reciben las entregas**: si la subtarea de Marcus falla, nadie ve las fichas del CRM que sí creó. Alex afirmó que no había empresas (incorrecto) y Sofia trabajó sin datos.
4. **Mensaje de parada engañoso**: dice «límite de la misión (1 $)» cuando se habían gastado 0,26 $; lo que no cabía era la reserva siguiente.

## Correcciones aprobadas e implementadas en local (30/10) · sin desplegar
Sin migración nueva: todo es código de la aplicación sobre las funciones de la 0007.

- **A · Fichas para Alex y Sofia**: `missionCompanies` devuelve las fichas creadas en la misión (aunque la subtarea fallara) y las reutilizadas, con ID, empresa, web/IG/teléfono, necesidad, notas (verificado / estimado / pendiente) y fuentes. Van en el mensaje inicial de Sofia, de Marcus y en la síntesis de Alex. Cada subtarea aparece como COMPLETADA, COMPLETADA SIN RESULTADOS o FALLIDA (con motivo y número de fichas creadas antes del fallo). Instrucción a Alex: nunca decir que no hay empresas si hay fichas. Una subtarea sin texto ya no guarda un documento vacío.
- **B · Sofia 32.000 tokens**: límites por agente (`CALL_LIMITS`): Sofia 32.000 tokens, 240 s de espera y lease de 285 s; Alex y Marcus 8.000 tokens, 150 s y 240 s. La reserva usa la salida máxima de cada agente (Sofia ≈ 0,02 $ por llamada). Un paso solo empieza si queda tiempo para la llamada completa + 20 s; si no, la pasada termina (evita repetir en bucle).
- **C · Parada con cifras**: «la siguiente llamada no cabe en el límite X», reserva necesaria, gasto real, reservas abiertas e inciertas, saldo disponible, y si el límite está realmente comprometido o no.
- **D · Una herramienta web por llamada (opción 1)**: Marcus recibe búsqueda O lectura, alternando (empieza leyendo si hay fichas reutilizadas con URL). Reserva de 2 pasadas en lugar de 3, sin suponer caché; parada por sobrecoste intacta. Opción 2 no implementada.
- **E · Teléfono**: hasta 100 caracteres, solo cifras y separadores, entre 6 y 30 cifras.

**Repetición de la misión**: casilla «Reutilizar las fichas ya investigadas del CRM (máx. 5)» al crear el encargo (`input.reuse_company_ids`). `crm.write` con `company_id` completa una ficha de la misión (las fuentes se añaden, no se sustituyen); no deja completar fichas de fuera de la misión; no duplica por nombre; el tope de 5 cuenta las reutilizadas (la base de datos sigue limitando a 5 las nuevas).

**Pruebas**: 135 en verde (12 nuevas en `tests/corrections.test.ts` + 1 en `tests/anthropic.test.ts`). Comprobado que las nuevas fallan con el código anterior.
