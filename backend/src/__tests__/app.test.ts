/**
 * CORS: acepta tanto el dominio con "www." como sin él aunque FRONTEND_URL
 * solo tenga configurada una de las dos variantes — ver el porqué en
 * app.ts (conVariantesWww). Cada test fija FRONTEND_URL y reimporta la app
 * con vi.resetModules(), porque origenesPermitidos se calcula una sola vez
 * al cargar el módulo.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

describe("CORS: variantes con/sin \"www.\" de FRONTEND_URL", () => {
  const original = process.env.FRONTEND_URL;

  afterEach(() => {
    process.env.FRONTEND_URL = original;
    vi.resetModules();
  });

  it("con FRONTEND_URL sin www, permite igualmente el origen con www", async () => {
    process.env.FRONTEND_URL = "https://aprobox.es";
    vi.resetModules();
    const { crearApp } = await import("../app");
    const app = crearApp();

    const sinWww = await request(app).get("/api/health").set("Origin", "https://aprobox.es");
    expect(sinWww.headers["access-control-allow-origin"]).toBe("https://aprobox.es");

    const conWww = await request(app).get("/api/health").set("Origin", "https://www.aprobox.es");
    expect(conWww.headers["access-control-allow-origin"]).toBe("https://www.aprobox.es");
  });

  it("con FRONTEND_URL con www, permite igualmente el origen sin www", async () => {
    process.env.FRONTEND_URL = "https://www.aprobox.es";
    vi.resetModules();
    const { crearApp } = await import("../app");
    const app = crearApp();

    const sinWww = await request(app).get("/api/health").set("Origin", "https://aprobox.es");
    expect(sinWww.headers["access-control-allow-origin"]).toBe("https://aprobox.es");
  });

  it("no permite un origen ajeno a FRONTEND_URL", async () => {
    process.env.FRONTEND_URL = "https://aprobox.es";
    vi.resetModules();
    const { crearApp } = await import("../app");
    const app = crearApp();

    const res = await request(app).get("/api/health").set("Origin", "https://otra-web-cualquiera.com");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
