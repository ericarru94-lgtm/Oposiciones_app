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

## Correcciones propuestas (pendientes de autorización)
Ver el resumen enviado al administrador.
