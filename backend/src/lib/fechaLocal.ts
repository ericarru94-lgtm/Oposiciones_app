/**
 * Zona horaria de referencia para "el día" de cualquier usuario. Toda la
 * base de usuarios actual es de España (oposición del Estado español), así
 * que no hace falta una zona horaria por usuario — basta con una fija para
 * todo el backend.
 *
 * Por qué existe este módulo: en Render (y en la mayoría de PaaS) el
 * proceso de Node corre en UTC por defecto, sin ninguna variable `TZ`
 * configurada (confirmado: no hay ni un `TZ` ni una referencia a zona
 * horaria en el resto del repo). Con el proceso en UTC,
 * `Date.prototype.getDate/getHours/getMonth/setHours` (hora LOCAL DEL
 * PROCESO, no la de Madrid) quedan desplazados 1h (CET, invierno) o 2h
 * (CEST, verano) respecto al día real del usuario. Ese desplazamiento
 * rompía en silencio — sin ningún error que llegara a Sentry, porque nunca
 * lanza una excepción, solo calcula mal — tres funciones de producto que
 * dependen de "qué día es hoy para el usuario": el límite diario de tests
 * gratuitos podía no resetear hasta 2h después de la medianoche real; la
 * racha de días consecutivos podía darse por rota para alguien que sí
 * estudió cada día (o, al revés, contar dos días reales como uno); y el
 * gráfico de evolución diaria desplazaba intentos al día anterior o
 * siguiente.
 *
 * Todas las funciones de aquí usan `Intl.DateTimeFormat` con `timeZone`
 * fijo en vez de los métodos de hora local de `Date` — así el cálculo es
 * correcto sin depender de en qué zona horaria corra el proceso, y
 * `Intl` ya gestiona el cambio de horario (CET/CEST) sin lógica propia.
 */
const ZONA_HORARIA_APP = "Europe/Madrid";
const UN_DIA_MS = 24 * 60 * 60 * 1000;

const formateadorClaveDia = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONA_HORARIA_APP,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const formateadorHoraDelDia = new Intl.DateTimeFormat("en-US", {
  timeZone: ZONA_HORARIA_APP,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/**
 * Clave "AAAA-MM-DD" del día civil al que pertenece `fecha` EN MADRID
 * (zero-padded e inequívoca, a diferencia de un `${getFullYear()}-${getMonth()}-${getDate()}`
 * hecho a mano, que además de usar la hora del proceso numera los meses de
 * 0 a 11 sin rellenar ceros).
 */
export function claveDiaMadrid(fecha: Date): string {
  // La locale "en-CA" da directamente "AAAA-MM-DD", sin tener que reordenar partes.
  return formateadorClaveDia.format(fecha);
}

function milisegundosTranscurridosHoyEnMadrid(fecha: Date): number {
  const partes = formateadorHoraDelDia.formatToParts(fecha);
  const valor = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value ?? 0);
  // formatToParts con hour12:false da "24" para la medianoche, no "00" — Number("24") hay que tratarlo como 0.
  const hora = valor("hour") % 24;
  return ((hora * 60 + valor("minute")) * 60 + valor("second")) * 1000 + fecha.getMilliseconds();
}

/** Instante exacto (UTC) en el que empieza, en Madrid, el día civil al que pertenece `fecha`. */
export function inicioDelDiaMadrid(fecha: Date): Date {
  return new Date(fecha.getTime() - milisegundosTranscurridosHoyEnMadrid(fecha));
}

/**
 * Instante exacto (UTC) en el que empieza "hoy" en Madrid. Sustituye al
 * patrón `const d = new Date(); d.setHours(0, 0, 0, 0);`, que calculaba la
 * medianoche en la hora local DEL PROCESO en vez de en Madrid.
 */
export function inicioDeHoyMadrid(): Date {
  return inicioDelDiaMadrid(new Date());
}

/**
 * Instante (UTC) en el que empieza, en Madrid, el día civil identificado
 * por una clave "AAAA-MM-DD" (ver `claveDiaMadrid`/`ultimasClavesDiaMadrid`).
 */
export function inicioDelDiaMadridDesdeClave(clave: string): Date {
  const [anio, mes, dia] = clave.split("-").map(Number);
  // Se ancla a mediodía UTC antes de normalizar: nunca está cerca de una
  // frontera de día ni en UTC ni en Madrid (que nunca está a más de 2h de
  // UTC), así que construir la fecha así no puede, por el cambio de
  // horario, caer accidentalmente en el día civil anterior o siguiente.
  return inicioDelDiaMadrid(new Date(Date.UTC(anio, mes - 1, dia, 12, 0, 0)));
}

/**
 * Las `n` claves de día (AAAA-MM-DD, Madrid) terminando en el día civil de
 * `fecha` (incluido), de más antigua a más reciente — para generar series
 * tipo "últimos N días" sin reconstruir cada fecha sumando/restando días
 * con los métodos de hora local de `Date` (que, con el proceso en UTC,
 * puede desalinear el día cerca de un cambio de horario en Madrid: restar
 * N veces 24h exactas desde un instante arbitrario no siempre aterriza en
 * el mismo día civil N días antes si de por medio hay un cambio de
 * horario). Cada clave se deriva de un instante fijado al mediodía UTC del
 * día de referencia, por la misma razón que en `inicioDelDiaMadridDesdeClave`.
 */
export function ultimasClavesDiaMadrid(n: number, fecha: Date = new Date()): string[] {
  const [anio, mes, dia] = claveDiaMadrid(fecha).split("-").map(Number);
  const mediodiaUTC = Date.UTC(anio, mes - 1, dia, 12, 0, 0);

  const claves: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    claves.push(claveDiaMadrid(new Date(mediodiaUTC - i * UN_DIA_MS)));
  }
  return claves;
}
