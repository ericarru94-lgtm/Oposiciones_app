import { describe, expect, it } from "vitest";
import { seleccionarProporcionalAlTemario } from "../seleccionProporcional";

interface Fixture {
  id: string;
  temaId: number | null;
}

function generarTema(temaId: number, cantidad: number): Fixture[] {
  return Array.from({ length: cantidad }, (_, i) => ({ id: `t${temaId}-${i}`, temaId }));
}

describe("seleccionarProporcionalAlTemario", () => {
  it("reparte el nº de preguntas exacto pedido cuando hay disponibilidad suficiente", () => {
    const disponibles = [...generarTema(1, 20), ...generarTema(2, 10), ...generarTema(3, 5)];
    const seleccion = seleccionarProporcionalAlTemario(disponibles, 14);
    expect(seleccion).toHaveLength(14);
  });

  it("reparte proporcionalmente al tamaño de cada tema (el resto mayor no desvía más de 1 pregunta)", () => {
    // 20/10/5 = 35 preguntas -> reparto exacto para 35 pedidas sería 20/10/5.
    const disponibles = [...generarTema(1, 20), ...generarTema(2, 10), ...generarTema(3, 5)];
    const seleccion = seleccionarProporcionalAlTemario(disponibles, 35);
    const porTema = new Map<number, number>();
    for (const p of seleccion) porTema.set(p.temaId as number, (porTema.get(p.temaId as number) ?? 0) + 1);
    expect(porTema.get(1)).toBe(20);
    expect(porTema.get(2)).toBe(10);
    expect(porTema.get(3)).toBe(5);
  });

  it("nunca pide a un tema más preguntas de las que tiene disponibles", () => {
    const disponibles = [...generarTema(1, 2), ...generarTema(2, 30)];
    const seleccion = seleccionarProporcionalAlTemario(disponibles, 25);
    const porTema = new Map<number, number>();
    for (const p of seleccion) porTema.set(p.temaId as number, (porTema.get(p.temaId as number) ?? 0) + 1);
    expect(porTema.get(1)).toBeLessThanOrEqual(2);
  });

  it("si se piden más preguntas que las disponibles en total, devuelve todas las disponibles", () => {
    const disponibles = [...generarTema(1, 3), ...generarTema(2, 4)];
    const seleccion = seleccionarProporcionalAlTemario(disponibles, 100);
    expect(seleccion).toHaveLength(7);
  });

  it("ignora preguntas sin temaId", () => {
    const disponibles = [...generarTema(1, 10), { id: "suelta", temaId: null }];
    const seleccion = seleccionarProporcionalAlTemario(disponibles, 5);
    expect(seleccion.every((p) => p.temaId === 1)).toBe(true);
  });

  it("devuelve una lista vacía si no hay preguntas disponibles", () => {
    expect(seleccionarProporcionalAlTemario([], 10)).toEqual([]);
  });

  it("no repite preguntas en la selección", () => {
    const disponibles = [...generarTema(1, 20), ...generarTema(2, 20)];
    const seleccion = seleccionarProporcionalAlTemario(disponibles, 30);
    const ids = new Set(seleccion.map((p) => p.id));
    expect(ids.size).toBe(seleccion.length);
  });
});
