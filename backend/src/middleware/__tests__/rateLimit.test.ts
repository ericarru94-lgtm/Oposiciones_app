/**
 * rateLimit.ts se desactiva del todo cuando NODE_ENV=test (ver el propio
 * archivo) para no interferir con el resto de la suite, así que estos
 * tests fuerzan NODE_ENV a otra cosa y reimportan el módulo con
 * vi.resetModules() para ejercer el comportamiento real de producción.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

describe("rateLimit (fuera de NODE_ENV=test)", () => {
  const original = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = "production";
    vi.resetModules();
  });

  afterEach(() => {
    process.env.NODE_ENV = original;
    vi.resetModules();
  });

  it("limitarNewsletter responde 429 al superar el límite de la ventana", async () => {
    const { limitarNewsletter } = await import("../rateLimit");
    const app = express();
    app.use(limitarNewsletter, (_req, res) => res.json({ ok: true }));

    for (let i = 0; i < 5; i++) {
      const res = await request(app).post("/");
      expect(res.status).toBe(200);
    }
    const bloqueada = await request(app).post("/");
    expect(bloqueada.status).toBe(429);
  });

  it("limitarRespuestasAnonimas responde 429 tras muchas peticiones sin sesión", async () => {
    const { limitarRespuestasAnonimas } = await import("../rateLimit");
    const app = express();
    app.use(limitarRespuestasAnonimas, (_req, res) => res.json({ ok: true }));

    for (let i = 0; i < 60; i++) {
      const res = await request(app).post("/");
      expect(res.status).toBe(200);
    }
    const bloqueada = await request(app).post("/");
    expect(bloqueada.status).toBe(429);
  });

  it("limitarRespuestasAnonimas nunca bloquea si req.auth está presente (usuario autenticado)", async () => {
    const { limitarRespuestasAnonimas } = await import("../rateLimit");
    const app = express();
    app.use((req, _res, next) => {
      req.auth = { usuarioId: "usuario-de-prueba" };
      next();
    });
    app.use(limitarRespuestasAnonimas, (_req, res) => res.json({ ok: true }));

    for (let i = 0; i < 70; i++) {
      const res = await request(app).post("/");
      expect(res.status).toBe(200);
    }
  });
});
