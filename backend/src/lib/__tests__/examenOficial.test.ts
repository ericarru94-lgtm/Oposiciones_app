import { describe, expect, it } from "vitest";
import { Bloque, TipoPregunta } from "@prisma/client";
import { ESTRUCTURA_EXAMEN_OFICIAL, seleccionarExamenOficial, type PreguntaSeleccionable } from "../examenOficial";

function generarPool(n: number, datos: Partial<PreguntaSeleccionable>): (PreguntaSeleccionable & { id: number })[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i,
    temaId: datos.bloque === Bloque.I ? 1 : datos.bloque === Bloque.II ? 2 : null,
    tipo: TipoPregunta.teorica,
    bloque: null,
    ...datos,
  }));
}

describe("seleccionarExamenOficial", () => {
  it("selecciona exactamente 30 de Bloque I, 30 psicotécnicas y 50 de Bloque II cuando el pool es amplio", () => {
    const disponibles = [
      ...generarPool(100, { bloque: Bloque.I, tipo: TipoPregunta.teorica }),
      ...generarPool(100, { bloque: Bloque.II, tipo: TipoPregunta.teorica }),
      ...generarPool(100, { bloque: null, tipo: TipoPregunta.psicotecnica }),
    ];

    const { bloqueI, psicotecnicas, bloqueII } = seleccionarExamenOficial(disponibles);

    expect(bloqueI).toHaveLength(ESTRUCTURA_EXAMEN_OFICIAL.parte1.bloqueI);
    expect(psicotecnicas).toHaveLength(ESTRUCTURA_EXAMEN_OFICIAL.parte1.psicotecnicas);
    expect(bloqueII).toHaveLength(ESTRUCTURA_EXAMEN_OFICIAL.parte2.bloqueII);
  });

  it("nunca mezcla preguntas de otro cupo: todo bloqueI es Bloque I y teórica, toda psicotecnicas es psicotécnica, todo bloqueII es Bloque II y teórica", () => {
    const disponibles = [
      ...generarPool(50, { bloque: Bloque.I, tipo: TipoPregunta.teorica }),
      ...generarPool(50, { bloque: Bloque.II, tipo: TipoPregunta.teorica }),
      ...generarPool(50, { bloque: null, tipo: TipoPregunta.psicotecnica }),
    ];

    const { bloqueI, psicotecnicas, bloqueII } = seleccionarExamenOficial(disponibles);

    expect(bloqueI.every((p) => p.bloque === Bloque.I && p.tipo === TipoPregunta.teorica)).toBe(true);
    expect(psicotecnicas.every((p) => p.tipo === TipoPregunta.psicotecnica)).toBe(true);
    expect(bloqueII.every((p) => p.bloque === Bloque.II && p.tipo === TipoPregunta.teorica)).toBe(true);
  });

  it("excluye del Bloque I las preguntas psicotécnicas y las de otro bloque, aunque estén en el mismo pool", () => {
    const disponibles = [
      ...generarPool(40, { bloque: Bloque.I, tipo: TipoPregunta.teorica }),
      ...generarPool(10, { bloque: Bloque.I, tipo: TipoPregunta.psicotecnica }), // no debería contar como "Bloque I" del cupo
      ...generarPool(10, { bloque: Bloque.II, tipo: TipoPregunta.teorica }),
    ];

    const { bloqueI } = seleccionarExamenOficial(disponibles);

    expect(bloqueI).toHaveLength(30);
    expect(bloqueI.every((p) => p.tipo === TipoPregunta.teorica && p.bloque === Bloque.I)).toBe(true);
  });

  it("cuando el pool de un cupo es menor que el requerido, devuelve todo lo disponible de ese cupo (sin completar con otros)", () => {
    const disponibles = [
      ...generarPool(10, { bloque: Bloque.I, tipo: TipoPregunta.teorica }), // solo 10, menos de 30
      ...generarPool(100, { bloque: Bloque.II, tipo: TipoPregunta.teorica }),
      ...generarPool(100, { bloque: null, tipo: TipoPregunta.psicotecnica }),
    ];

    const { bloqueI, psicotecnicas, bloqueII } = seleccionarExamenOficial(disponibles);

    expect(bloqueI).toHaveLength(10);
    expect(psicotecnicas).toHaveLength(30);
    expect(bloqueII).toHaveLength(50);
  });

  it("no repite preguntas dentro del mismo cupo", () => {
    const disponibles = generarPool(30, { bloque: Bloque.I, tipo: TipoPregunta.teorica });
    const { bloqueI } = seleccionarExamenOficial(disponibles);
    const idsUnicos = new Set(bloqueI.map((p) => p.id));
    expect(idsUnicos.size).toBe(bloqueI.length);
  });
});
