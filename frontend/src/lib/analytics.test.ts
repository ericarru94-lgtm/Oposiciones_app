import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `MEASUREMENT_ID`/`ADS_ID` se leen una sola vez al importar el módulo,
 * así que cada test que necesite un valor distinto (o ninguno) hace
 * `vi.resetModules()` + un `import()` dinámico tras `vi.stubEnv`.
 */
async function importarConId(id: string | undefined, adsId?: string, signupSendTo?: string) {
  vi.resetModules();
  // Explícito incluso para "sin ID": frontend/.env (cargado por Vite en
  // los tests) puede traer un VITE_GA_MEASUREMENT_ID/VITE_GOOGLE_ADS_ID/
  // VITE_GOOGLE_ADS_SIGNUP_SEND_TO reales para desarrollo, y sin este stub
  // esos valores ambiente se colarían en el test.
  vi.stubEnv("VITE_GA_MEASUREMENT_ID", id ?? "");
  vi.stubEnv("VITE_GOOGLE_ADS_ID", adsId ?? "");
  vi.stubEnv("VITE_GOOGLE_ADS_SIGNUP_SEND_TO", signupSendTo ?? "");
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
    const { analyticsConfigurado, inicializarAnalytics, registrarEvento, registrarVistaPagina } =
      await importarConId(undefined);
    expect(analyticsConfigurado()).toBe(false);

    inicializarAnalytics();
    registrarEvento("sign_up");
    registrarVistaPagina("/home");

    expect(document.querySelectorAll('script[src*="googletagmanager"]').length).toBe(0);
    expect(window.gtag).toBeUndefined();
  });
});

describe("con VITE_GA_MEASUREMENT_ID configurada", () => {
  it("inicializarAnalytics() inyecta el script una sola vez, con consentimiento denegado por defecto", async () => {
    const { inicializarAnalytics } = await importarConId("G-TEST123");

    inicializarAnalytics();
    inicializarAnalytics(); // segunda llamada: no debe duplicar el script ni la config

    const scripts = document.querySelectorAll('script[src*="googletagmanager"]');
    expect(scripts.length).toBe(1);
    expect(scripts[0].getAttribute("src")).toBe("https://www.googletagmanager.com/gtag/js?id=G-TEST123");
    expect(window.dataLayer).toEqual([
      [
        "consent",
        "default",
        {
          ad_storage: "denied",
          analytics_storage: "denied",
          ad_user_data: "denied",
          ad_personalization: "denied",
        },
      ],
      ["js", expect.any(Date)],
      ["config", "G-TEST123"],
    ]);
  });

  it("con VITE_GOOGLE_ADS_ID configurada, también llama a gtag('config', ...) para Ads", async () => {
    const { inicializarAnalytics } = await importarConId("G-TEST123", "AW-TEST456");

    inicializarAnalytics();

    expect(window.dataLayer).toEqual(expect.arrayContaining([["config", "AW-TEST456"]]));
  });

  it("registrarEvento/registrarVistaPagina no hacen nada antes de inicializarAnalytics()", async () => {
    const { registrarEvento, registrarVistaPagina } = await importarConId("G-TEST123");

    registrarEvento("sign_up");
    registrarVistaPagina("/home");

    expect(window.dataLayer).toBeUndefined();
  });

  it("tras inicializarAnalytics(), registrarEvento y registrarVistaPagina empujan al dataLayer", async () => {
    const { inicializarAnalytics, registrarEvento, registrarVistaPagina } = await importarConId("G-TEST123");
    inicializarAnalytics();

    registrarVistaPagina("/upgrade?checkout=cancelado");
    registrarEvento("suscripcion_premium", { valor: 4.99 });

    expect(window.dataLayer).toEqual(
      expect.arrayContaining([
        ["event", "page_view", { page_path: "/upgrade?checkout=cancelado" }],
        ["event", "suscripcion_premium", { valor: 4.99 }],
      ])
    );
  });

  it("registrarConversionRegistro() no hace nada sin VITE_GOOGLE_ADS_SIGNUP_SEND_TO configurada", async () => {
    const { inicializarAnalytics, registrarConversionRegistro } = await importarConId("G-TEST123");
    inicializarAnalytics();

    registrarConversionRegistro();

    expect(window.dataLayer).not.toEqual(expect.arrayContaining([["event", "conversion", expect.anything()]]));
  });

  it("con VITE_GOOGLE_ADS_SIGNUP_SEND_TO configurada, registrarConversionRegistro() manda la conversión de Ads", async () => {
    const { inicializarAnalytics, registrarConversionRegistro } = await importarConId(
      "G-TEST123",
      "AW-TEST456",
      "AW-TEST456/abcDEF123"
    );
    inicializarAnalytics();

    registrarConversionRegistro();

    expect(window.dataLayer).toEqual(
      expect.arrayContaining([["event", "conversion", { send_to: "AW-TEST456/abcDEF123" }]])
    );
  });

  it("actualizarConsentimiento() actualiza el estado de consent tras la decisión del usuario", async () => {
    const { inicializarAnalytics, actualizarConsentimiento } = await importarConId("G-TEST123");
    inicializarAnalytics();

    actualizarConsentimiento(true);

    expect(window.dataLayer).toEqual(
      expect.arrayContaining([
        [
          "consent",
          "update",
          {
            ad_storage: "granted",
            analytics_storage: "granted",
            ad_user_data: "granted",
            ad_personalization: "granted",
          },
        ],
      ])
    );
  });
});
