import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `MEASUREMENT_ID` se lee una sola vez al importar el módulo, así que
 * cada test que necesite un valor distinto (o ninguno) hace
 * `vi.resetModules()` + un `import()` dinámico tras `vi.stubEnv`.
 */
async function importarConId(id: string | undefined) {
  vi.resetModules();
  // Explícito incluso para "sin ID": frontend/.env (cargado por Vite en
  // los tests) puede traer un VITE_GA_MEASUREMENT_ID real para desarrollo,
  // y sin este stub ese valor ambiente se colaría en el test.
  vi.stubEnv("VITE_GA_MEASUREMENT_ID", id ?? "");
  return import("./analytics");
}

function limpiarScriptsYDataLayer() {
  document.querySelectorAll('script[src*="googletagmanager"]').forEach((el) => el.remove());
  delete (window as { dataLayer?: unknown }).dataLayer;
  delete (window as { gtag?: unknown }).gtag;
}

beforeEach(limpiarScriptsYDataLayer);
afterEach(() => {
  vi.unstubAllEnvs();
  limpiarScriptsYDataLayer();
});

describe("sin VITE_GA_MEASUREMENT_ID configurada", () => {
  it("analyticsConfigurado() es false y el resto de funciones son un no-op", async () => {
    const { analyticsConfigurado, cargarAnalytics, registrarEvento, registrarVistaPagina } = await importarConId(
      undefined
    );
    expect(analyticsConfigurado()).toBe(false);

    cargarAnalytics();
    registrarEvento("sign_up");
    registrarVistaPagina("/home");

    expect(document.querySelectorAll('script[src*="googletagmanager"]').length).toBe(0);
    expect(window.gtag).toBeUndefined();
  });
});

describe("con VITE_GA_MEASUREMENT_ID configurada", () => {
  it("cargarAnalytics() inyecta el script una sola vez y llama a gtag('config', ...)", async () => {
    const { cargarAnalytics } = await importarConId("G-TEST123");

    cargarAnalytics();
    cargarAnalytics(); // segunda llamada: no debe duplicar el script ni la config

    const scripts = document.querySelectorAll('script[src*="googletagmanager"]');
    expect(scripts.length).toBe(1);
    expect(scripts[0].getAttribute("src")).toBe("https://www.googletagmanager.com/gtag/js?id=G-TEST123");
    expect(window.dataLayer).toEqual([
      ["js", expect.any(Date)],
      ["config", "G-TEST123"],
    ]);
  });

  it("registrarEvento/registrarVistaPagina no hacen nada antes de cargarAnalytics()", async () => {
    const { registrarEvento, registrarVistaPagina } = await importarConId("G-TEST123");

    registrarEvento("sign_up");
    registrarVistaPagina("/home");

    expect(window.dataLayer).toBeUndefined();
  });

  it("tras cargarAnalytics(), registrarEvento y registrarVistaPagina empujan al dataLayer", async () => {
    const { cargarAnalytics, registrarEvento, registrarVistaPagina } = await importarConId("G-TEST123");
    cargarAnalytics();

    registrarVistaPagina("/upgrade?checkout=cancelado");
    registrarEvento("suscripcion_premium", { valor: 4.99 });

    expect(window.dataLayer).toEqual(
      expect.arrayContaining([
        ["event", "page_view", { page_path: "/upgrade?checkout=cancelado" }],
        ["event", "suscripcion_premium", { valor: 4.99 }],
      ])
    );
  });
});
