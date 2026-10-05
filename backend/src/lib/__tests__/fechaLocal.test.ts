import { afterEach, describe, expect, it, vi } from "vitest";
import {
  claveDiaMadrid,
  inicioDelDiaMadrid,
  inicioDelDiaMadridDesdeClave,
  inicioDeHoyMadrid,
  ultimasClavesDiaMadrid,
} from "../fechaLocal";

const UN_DIA_MS = 24 * 60 * 60 * 1000;

afterEach(() => {
  vi.useRealTimers();
});

describe("claveDiaMadrid", () => {
  it("usa el día civil de Madrid, no el de UTC, en horario de verano (CEST, UTC+2)", () => {
    // 23:30 UTC del 2 de abril = 01:30 del 3 de abril en Madrid (CEST):
    // en Madrid ya es "otro día" aunque en UTC siga siendo el mismo.
    // Esta es justo la franja horaria (22:00-24:00 UTC en CEST, 23:00-24:00
    // en CET) donde el bug original clasificaba mal el día: un proceso
    // corriendo en UTC (como en Render, sin TZ configurada) seguía
    // contando "hoy" como el día de UTC, con hasta 2h de retraso respecto
    // a la medianoche real del usuario en Madrid.
    expect(claveDiaMadrid(new Date("2026-04-02T23:30:00Z"))).toBe("2026-04-03");
    // Un instante antes (21:30 UTC = 23:30 Madrid) todavía es el día anterior.
    expect(claveDiaMadrid(new Date("2026-04-02T21:30:00Z"))).toBe("2026-04-02");
  });

  it("usa el día civil de Madrid en horario de invierno (CET, UTC+1)", () => {
    // 23:30 UTC del 2 de enero = 00:30 del 3 de enero en Madrid (CET).
    expect(claveDiaMadrid(new Date("2026-01-02T23:30:00Z"))).toBe("2026-01-03");
    expect(claveDiaMadrid(new Date("2026-01-02T22:30:00Z"))).toBe("2026-01-02");
  });

  it("da el formato AAAA-MM-DD con ceros de relleno (mes y día de un dígito)", () => {
    // Mediodía UTC: lejos de cualquier frontera de día, válido en CET y CEST.
    expect(claveDiaMadrid(new Date("2026-01-05T12:00:00Z"))).toBe("2026-01-05");
    expect(claveDiaMadrid(new Date("2026-11-09T12:00:00Z"))).toBe("2026-11-09");
  });
});

describe("inicioDelDiaMadrid / inicioDelDiaMadridDesdeClave", () => {
  it("el instante devuelto pertenece al mismo día que se le pasó, y el milisegundo justo anterior pertenece al día anterior", () => {
    const instante = new Date("2026-04-02T23:30:00Z"); // "2026-04-03" en Madrid
    const inicio = inicioDelDiaMadrid(instante);

    expect(claveDiaMadrid(inicio)).toBe("2026-04-03");
    expect(claveDiaMadrid(new Date(inicio.getTime() - 1))).toBe("2026-04-02");
  });

  it("inicioDelDiaMadridDesdeClave es el inverso de claveDiaMadrid para cualquier instante", () => {
    const muestras = [
      "2026-04-02T23:30:00Z",
      "2026-01-15T03:00:00Z",
      "2026-07-20T10:00:00Z",
      "2026-10-25T01:30:00Z", // madrugada del cambio de hora de octubre 2026
    ];
    for (const iso of muestras) {
      const instante = new Date(iso);
      const clave = claveDiaMadrid(instante);
      expect(claveDiaMadrid(inicioDelDiaMadridDesdeClave(clave))).toBe(clave);
    }
  });
});

describe("inicioDeHoyMadrid", () => {
  it("usa el reloj del sistema y respeta el mismo desfase Madrid/UTC que claveDiaMadrid", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-02T23:30:00Z")); // "hoy" en Madrid ya es el 3 de abril

    const inicio = inicioDeHoyMadrid();

    expect(claveDiaMadrid(inicio)).toBe("2026-04-03");
    expect(inicio.getTime()).toBeLessThanOrEqual(Date.now());
  });
});

describe("ultimasClavesDiaMadrid", () => {
  it("da N claves consecutivas y crecientes terminando en el día de referencia", () => {
    const claves = ultimasClavesDiaMadrid(5, new Date("2026-06-10T12:00:00Z"));
    expect(claves).toEqual(["2026-06-06", "2026-06-07", "2026-06-08", "2026-06-09", "2026-06-10"]);
  });

  it("no salta ni repite ningún día al cruzar el cambio a horario de verano (29 de marzo de 2026)", () => {
    const claves = ultimasClavesDiaMadrid(7, new Date("2026-04-01T12:00:00Z"));
    expect(claves).toEqual([
      "2026-03-26",
      "2026-03-27",
      "2026-03-28",
      "2026-03-29", // España adelanta el reloj (02:00 -> 03:00): este día solo tiene 23h en Madrid
      "2026-03-30",
      "2026-03-31",
      "2026-04-01",
    ]);
  });

  it("no salta ni repite ningún día al cruzar el cambio a horario de invierno (25 de octubre de 2026)", () => {
    const claves = ultimasClavesDiaMadrid(7, new Date("2026-10-27T12:00:00Z"));
    expect(claves).toEqual([
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
      "2026-10-25", // España atrasa el reloj (03:00 -> 02:00): este día tiene 25h en Madrid
      "2026-10-26",
      "2026-10-27",
    ]);
  });

  it("cada clave consecutiva representa exactamente un día más que la anterior (sin huecos ni duplicados), incluso en los días de cambio de hora", () => {
    for (const fecha of ["2026-04-01T12:00:00Z", "2026-10-27T12:00:00Z"]) {
      const claves = ultimasClavesDiaMadrid(10, new Date(fecha));
      for (let i = 1; i < claves.length; i++) {
        const anterior = inicioDelDiaMadridDesdeClave(claves[i - 1]);
        const actual = inicioDelDiaMadridDesdeClave(claves[i]);
        // La distancia real en ms entre dos medianoches de Madrid consecutivas
        // es 23h, 24h o 25h según el cambio de hora — nunca exactamente 0 ni
        // el doble de un día, que es lo que delataría un día repetido o saltado.
        const diferenciaHoras = (actual.getTime() - anterior.getTime()) / (60 * 60 * 1000);
        expect(diferenciaHoras).toBeGreaterThanOrEqual(23);
        expect(diferenciaHoras).toBeLessThanOrEqual(25);
      }
      expect(new Set(claves).size).toBe(claves.length); // ninguna clave repetida
    }
  });

  it("usa Date.now() cuando no se le pasa fecha de referencia", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T12:00:00Z"));
    expect(ultimasClavesDiaMadrid(1)).toEqual(["2026-06-10"]);
  });
});

// Documenta explícitamente el escenario de negocio que motivó este módulo:
// con el proceso corriendo en UTC (como en Render, por defecto, sin TZ
// configurada), calcular "hoy" con `new Date(); d.setHours(0,0,0,0)` usaba
// la medianoche del proceso (UTC) en vez de la de Madrid.
describe("regresión: medianoche del proceso en UTC vs. medianoche real en Madrid", () => {
  it("un intento justo antes de la medianoche de Madrid ya debe contar para el día siguiente, no para el día de UTC", () => {
    const antesDeLaMedianocheDeMadrid = new Date("2026-04-02T23:30:00Z"); // 01:30 del 3 de abril en Madrid

    const diaSegunProcesoEnUTC = `${antesDeLaMedianocheDeMadrid.getUTCFullYear()}-${String(
      antesDeLaMedianocheDeMadrid.getUTCMonth() + 1
    ).padStart(2, "0")}-${String(antesDeLaMedianocheDeMadrid.getUTCDate()).padStart(2, "0")}`;
    const diaSegunMadrid = claveDiaMadrid(antesDeLaMedianocheDeMadrid);

    // Si esta aserción fallara (es decir, si coincidieran), el caso de prueba
    // no demostraría nada — se deja explícita para que quede claro que el
    // fallo original SÍ era observable en esta franja horaria.
    expect(diaSegunMadrid).not.toBe(diaSegunProcesoEnUTC);
    expect(diaSegunProcesoEnUTC).toBe("2026-04-02");
    expect(diaSegunMadrid).toBe("2026-04-03");
  });

  it("el inicio del día de Madrid cae hasta 2h antes que el inicio del día de UTC (nunca después)", () => {
    const ahora = new Date("2026-07-15T10:00:00Z");
    const inicioUTC = Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate());
    const inicioMadrid = inicioDelDiaMadrid(ahora);

    const diferenciaMs = inicioUTC - inicioMadrid.getTime();
    expect(diferenciaMs).toBe(2 * 60 * 60 * 1000); // CEST = UTC+2 en julio
  });
});
