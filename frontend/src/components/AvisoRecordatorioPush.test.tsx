import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AvisoRecordatorioPush } from "./AvisoRecordatorioPush";
import { useSession } from "../context/SessionContext";
import { activarRecordatorioDiario } from "../lib/notificacionesPush";

vi.mock("../context/SessionContext", () => ({
  useSession: vi.fn(),
}));
vi.mock("../lib/notificacionesPush", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/notificacionesPush")>()),
  activarRecordatorioDiario: vi.fn(),
}));

function definirSoportePush(permiso: NotificationPermission | undefined) {
  if (permiso === undefined) {
    // @ts-expect-error borrar Notification para simular navegador sin soporte
    delete window.Notification;
    // @ts-expect-error idem serviceWorker/PushManager
    delete navigator.serviceWorker;
    return;
  }
  Object.defineProperty(window, "Notification", {
    configurable: true,
    value: { permission: permiso, requestPermission: vi.fn() },
  });
  if (!("serviceWorker" in navigator)) {
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: {} });
  }
  if (!("PushManager" in window)) {
    Object.defineProperty(window, "PushManager", { configurable: true, value: function PushManager() {} });
  }
}

describe("AvisoRecordatorioPush", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(useSession).mockReturnValue({
      getToken: vi.fn().mockResolvedValue("token-test"),
    } as unknown as ReturnType<typeof useSession>);
    vi.mocked(activarRecordatorioDiario).mockReset();
  });

  afterEach(() => {
    definirSoportePush(undefined);
  });

  it("no se muestra con menos de 2 días de racha", () => {
    definirSoportePush("default");
    render(<AvisoRecordatorioPush diasRacha={1} />);
    expect(screen.queryByText(/¿Te avisamos cada día/i)).not.toBeInTheDocument();
  });

  it("no se muestra si el navegador no soporta Web Push", () => {
    definirSoportePush(undefined);
    render(<AvisoRecordatorioPush diasRacha={5} />);
    expect(screen.queryByText(/¿Te avisamos cada día/i)).not.toBeInTheDocument();
  });

  it("no se muestra si el permiso ya se concedió o denegó antes", () => {
    definirSoportePush("granted");
    render(<AvisoRecordatorioPush diasRacha={5} />);
    expect(screen.queryByText(/¿Te avisamos cada día/i)).not.toBeInTheDocument();
  });

  it("no se muestra si el usuario ya lo descartó antes (localStorage)", () => {
    localStorage.setItem("aprobox-push-descartado", "1");
    definirSoportePush("default");
    render(<AvisoRecordatorioPush diasRacha={5} />);
    expect(screen.queryByText(/¿Te avisamos cada día/i)).not.toBeInTheDocument();
  });

  it("se muestra con 2+ días de racha y permiso pendiente, y 'Ahora no' lo descarta sin volver a mostrarlo", async () => {
    definirSoportePush("default");
    const user = userEvent.setup();
    render(<AvisoRecordatorioPush diasRacha={2} />);

    expect(await screen.findByText(/¿Te avisamos cada día/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Ahora no" }));

    expect(screen.queryByText(/¿Te avisamos cada día/i)).not.toBeInTheDocument();
    expect(localStorage.getItem("aprobox-push-descartado")).toBe("1");
    expect(activarRecordatorioDiario).not.toHaveBeenCalled();
  });

  it("'Sí, avísame' llama a activarRecordatorioDiario y oculta el aviso si tiene éxito", async () => {
    definirSoportePush("default");
    vi.mocked(activarRecordatorioDiario).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<AvisoRecordatorioPush diasRacha={3} />);

    await user.click(await screen.findByRole("button", { name: "Sí, avísame" }));

    await waitFor(() => expect(activarRecordatorioDiario).toHaveBeenCalledWith("token-test"));
    await waitFor(() => expect(screen.queryByText(/¿Te avisamos cada día/i)).not.toBeInTheDocument());
  });

  it("muestra un mensaje de error sin ocultar el aviso si la activación falla", async () => {
    definirSoportePush("default");
    vi.mocked(activarRecordatorioDiario).mockResolvedValue({ ok: false, motivo: "error" });
    const user = userEvent.setup();
    render(<AvisoRecordatorioPush diasRacha={3} />);

    await user.click(await screen.findByRole("button", { name: "Sí, avísame" }));

    expect(await screen.findByText(/No se ha podido activar/i)).toBeInTheDocument();
  });
});
