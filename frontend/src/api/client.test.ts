import { afterEach, describe, expect, it, vi } from "vitest";

describe("apiFetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("lanza un error legible (no un SyntaxError críptico) si la respuesta no es JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve("<!DOCTYPE html><html>...</html>"),
      })
    );

    const { apiFetch } = await import("./client");
    await expect(apiFetch("/preguntas/temas")).rejects.toThrow(/VITE_API_URL/);
  });

  it("una respuesta JSON normal se resuelve sin problema", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ ok: true })),
      })
    );

    const { apiFetch } = await import("./client");
    await expect(apiFetch("/health")).resolves.toEqual({ ok: true });
  });

  it("un VITE_API_URL vacío no deja las peticiones en una ruta relativa (cae al valor por defecto)", async () => {
    vi.stubEnv("VITE_API_URL", "");
    let urlUsada = "";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        urlUsada = url;
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve("{}") });
      })
    );

    vi.resetModules();
    const { apiFetch } = await import("./client");
    await apiFetch("/preguntas/temas");

    expect(urlUsada.startsWith("http://")).toBe(true);
  });
});
