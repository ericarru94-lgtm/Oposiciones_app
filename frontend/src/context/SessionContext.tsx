import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth, useUser } from "@clerk/clerk-react";
import { actualizarOnboarding, obtenerUsuarioActual, reclamarSesionAnonima } from "../api/endpoints";
import { apiFetch } from "../api/client";
import type { Usuario } from "../api/types";

const CLAVE_SESION_ANONIMA = "oposiciones:sesionAnonima";
const CLAVE_NIVEL_PENDIENTE = "oposiciones:nivelInicialPendiente";
const CLAVE_ONBOARDING_COMPLETO = "oposiciones:onboardingCompleto";
const CLAVE_SESION_RECLAMADA = "oposiciones:sesionAnonimaReclamada";
const CLAVE_BYPASS_TOKEN = "oposiciones:e2eBypassToken";

/**
 * Sin VITE_CLERK_PUBLISHABLE_KEY (solo pasa en el modo E2E de Playwright,
 * ver .env.e2e) no hay forma de montar <ClerkProvider>, así que se usa un
 * SessionProvider alternativo que Playwright controla inyectando un token
 * de bypass en localStorage — ver e2e/helpers.ts y backend/docs/clerk.md.
 * Nunca ocurre en un despliegue real: sin esta clave tampoco hay forma de
 * generar ese token desde la UI (registrarOIniciarSesionBypass exige el
 * secreto de AUTH_TEST_BYPASS_SECRET, que el backend solo acepta si él
 * mismo lo tiene configurado, cosa que jamás pasa fuera de .env.e2e).
 */
const USANDO_CLERK = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

function generarSesionAnonima(): string {
  return crypto.randomUUID();
}

interface PerfilExterno {
  nombreCompleto: string | null;
  email: string | null;
  imagenUrl: string | null;
}

interface SessionContextValue {
  estaAutenticado: boolean;
  usuario: Usuario | null;
  cargando: boolean;
  /** Identificador estable del visitante anónimo, usado para el mini-test y el límite diario antes de registrarse. */
  sesionAnonima: string;
  /** Nivel de partida elegido en el onboarding, guardado hasta que haya cuenta donde persistirlo. */
  nivelInicialPendiente: string | null;
  setNivelInicialPendiente: (nivel: string) => void;
  onboardingCompleto: boolean;
  /** Token para llamar a la API (Bearer). Async porque un token de Clerk puede necesitar refrescarse. */
  getToken: () => Promise<string | null>;
  logout: () => void;
  /** Datos que solo conoce el proveedor de identidad (nombre, email, foto), para la pantalla de perfil. */
  perfilExterno: PerfilExterno | null;
}

const SessionContext = createContext<SessionContextValue | null>(null);

function useEstadoCompartido() {
  const [sesionAnonima] = useState<string>(() => {
    const existente = localStorage.getItem(CLAVE_SESION_ANONIMA);
    if (existente) return existente;
    const nueva = generarSesionAnonima();
    localStorage.setItem(CLAVE_SESION_ANONIMA, nueva);
    return nueva;
  });
  const [nivelInicialPendiente, setNivelInicialPendienteState] = useState<string | null>(() =>
    localStorage.getItem(CLAVE_NIVEL_PENDIENTE)
  );
  const [onboardingCompleto, setOnboardingCompleto] = useState<boolean>(
    () => localStorage.getItem(CLAVE_ONBOARDING_COMPLETO) === "1"
  );

  const setNivelInicialPendiente = useCallback((nivel: string) => {
    localStorage.setItem(CLAVE_NIVEL_PENDIENTE, nivel);
    setNivelInicialPendienteState(nivel);
  }, []);

  return { sesionAnonima, nivelInicialPendiente, setNivelInicialPendiente, onboardingCompleto, setOnboardingCompleto };
}

/**
 * Tras cada login (Clerk o bypass), en segundo plano: guarda el nivel
 * inicial pendiente del onboarding (una vez) y reclama los intentos
 * respondidos como anónimo (reclamarIntentosAnonimos es idempotente en el
 * backend, pero se marca aquí igualmente para no llamarlo en cada carga).
 */
function useSincronizarTrasLogin(params: {
  estaAutenticado: boolean;
  getToken: () => Promise<string | null>;
  sesionAnonima: string;
  nivelInicialPendiente: string | null;
  marcarOnboardingCompleto: () => void;
}) {
  const { estaAutenticado, getToken, sesionAnonima, nivelInicialPendiente, marcarOnboardingCompleto } = params;
  useEffect(() => {
    if (!estaAutenticado) return;
    marcarOnboardingCompleto();

    const yaReclamada = localStorage.getItem(CLAVE_SESION_RECLAMADA) === sesionAnonima;
    if (yaReclamada) return;

    (async () => {
      const token = await getToken();
      if (!token) return;
      if (nivelInicialPendiente) {
        await actualizarOnboarding(token, nivelInicialPendiente).catch(() => {});
        localStorage.removeItem(CLAVE_NIVEL_PENDIENTE);
      }
      await reclamarSesionAnonima(token, sesionAnonima).catch(() => {});
      localStorage.setItem(CLAVE_SESION_RECLAMADA, sesionAnonima);
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estaAutenticado, sesionAnonima]);
}

function SessionProviderClerk({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, getToken: getClerkToken, signOut } = useAuth();
  const { user } = useUser();
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [cargandoUsuario, setCargandoUsuario] = useState(true);
  const compartido = useEstadoCompartido();
  const { setOnboardingCompleto } = compartido;

  const estaAutenticado = Boolean(isLoaded && isSignedIn);

  const getToken = useCallback(async () => {
    if (!isSignedIn) return null;
    return getClerkToken();
  }, [isSignedIn, getClerkToken]);

  const marcarOnboardingCompleto = useCallback(() => {
    localStorage.setItem(CLAVE_ONBOARDING_COMPLETO, "1");
    setOnboardingCompleto(true);
  }, [setOnboardingCompleto]);

  useSincronizarTrasLogin({
    estaAutenticado,
    getToken,
    sesionAnonima: compartido.sesionAnonima,
    nivelInicialPendiente: compartido.nivelInicialPendiente,
    marcarOnboardingCompleto,
  });

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setUsuario(null);
      setCargandoUsuario(false);
      return;
    }
    let cancelado = false;
    (async () => {
      const token = await getClerkToken();
      if (!token) {
        if (!cancelado) setCargandoUsuario(false);
        return;
      }
      try {
        const datos = await obtenerUsuarioActual(token);
        if (!cancelado) setUsuario(datos);
      } finally {
        if (!cancelado) setCargandoUsuario(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [isLoaded, isSignedIn, getClerkToken]);

  const logout = useCallback(() => {
    void signOut();
  }, [signOut]);

  const perfilExterno = useMemo<PerfilExterno | null>(() => {
    if (!isSignedIn || !user) return null;
    return {
      nombreCompleto: [user.firstName, user.lastName].filter(Boolean).join(" ") || null,
      email: user.primaryEmailAddress?.emailAddress ?? null,
      imagenUrl: user.imageUrl ?? null,
    };
  }, [isSignedIn, user]);

  const value = useMemo<SessionContextValue>(
    () => ({
      estaAutenticado,
      usuario,
      cargando: !isLoaded || cargandoUsuario,
      sesionAnonima: compartido.sesionAnonima,
      nivelInicialPendiente: compartido.nivelInicialPendiente,
      setNivelInicialPendiente: compartido.setNivelInicialPendiente,
      onboardingCompleto: compartido.onboardingCompleto,
      getToken,
      logout,
      perfilExterno,
    }),
    [estaAutenticado, usuario, isLoaded, cargandoUsuario, compartido, getToken, logout, perfilExterno]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

function SessionProviderBypass({ children }: { children: ReactNode }) {
  const [tokenBypass, setTokenBypass] = useState<string | null>(() => localStorage.getItem(CLAVE_BYPASS_TOKEN));
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [cargandoUsuario, setCargandoUsuario] = useState(true);
  const compartido = useEstadoCompartido();
  const { setOnboardingCompleto } = compartido;

  const estaAutenticado = Boolean(tokenBypass);

  const getToken = useCallback(async () => tokenBypass, [tokenBypass]);

  const marcarOnboardingCompleto = useCallback(() => {
    localStorage.setItem(CLAVE_ONBOARDING_COMPLETO, "1");
    setOnboardingCompleto(true);
  }, [setOnboardingCompleto]);

  useSincronizarTrasLogin({
    estaAutenticado,
    getToken,
    sesionAnonima: compartido.sesionAnonima,
    nivelInicialPendiente: compartido.nivelInicialPendiente,
    marcarOnboardingCompleto,
  });

  useEffect(() => {
    if (!tokenBypass) {
      setCargandoUsuario(false);
      return;
    }
    obtenerUsuarioActual(tokenBypass)
      .then(setUsuario)
      .catch(() => {
        localStorage.removeItem(CLAVE_BYPASS_TOKEN);
        setTokenBypass(null);
      })
      .finally(() => setCargandoUsuario(false));
  }, [tokenBypass]);

  const logout = useCallback(() => {
    localStorage.removeItem(CLAVE_BYPASS_TOKEN);
    setTokenBypass(null);
    setUsuario(null);
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      estaAutenticado,
      usuario,
      cargando: cargandoUsuario,
      sesionAnonima: compartido.sesionAnonima,
      nivelInicialPendiente: compartido.nivelInicialPendiente,
      setNivelInicialPendiente: compartido.setNivelInicialPendiente,
      onboardingCompleto: compartido.onboardingCompleto,
      getToken,
      logout,
      perfilExterno: usuario ? { nombreCompleto: null, email: usuario.email, imagenUrl: null } : null,
    }),
    [estaAutenticado, usuario, cargandoUsuario, compartido, getToken, logout]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/**
 * Solo para el modo bypass (E2E sin Clerk): crea/reutiliza el Usuario por
 * email vía /auth/registro-bypass y guarda el token resultante. Lo llaman
 * las páginas de login/registro cuando `USANDO_CLERK` es falso.
 *
 * Reclama la sesión anónima y guarda el nivel inicial ANTES de navegar (no
 * se deja a useSincronizarTrasLogin, que corre tras el remontado): así Home
 * ya ve el progreso reclamado en su primera carga, sin una carrera entre
 * su fetch y esta llamada asíncrona.
 */
export async function iniciarSesionBypass(email: string, destino: string): Promise<void> {
  const secreto = import.meta.env.VITE_E2E_AUTH_BYPASS_SECRET as string | undefined;
  if (!secreto) {
    throw new Error("VITE_E2E_AUTH_BYPASS_SECRET no está configurado: el modo bypass solo funciona en E2E.");
  }
  const { usuarioId } = await apiFetch<{ usuarioId: string }>("/auth/registro-bypass", {
    method: "POST",
    body: { email, secreto },
  });
  const token = `e2e-bypass:${secreto}:${usuarioId}`;

  const sesionAnonima = localStorage.getItem(CLAVE_SESION_ANONIMA);
  const nivelInicialPendiente = localStorage.getItem(CLAVE_NIVEL_PENDIENTE);
  if (nivelInicialPendiente) {
    await actualizarOnboarding(token, nivelInicialPendiente).catch(() => {});
    localStorage.removeItem(CLAVE_NIVEL_PENDIENTE);
  }
  if (sesionAnonima) {
    await reclamarSesionAnonima(token, sesionAnonima).catch(() => {});
    localStorage.setItem(CLAVE_SESION_RECLAMADA, sesionAnonima);
  }
  localStorage.setItem(CLAVE_ONBOARDING_COMPLETO, "1");
  localStorage.setItem(CLAVE_BYPASS_TOKEN, token);

  // Navegación completa (no un simple setState) para que SessionProviderBypass
  // recoja el nuevo token de localStorage al montarse de cero.
  window.location.href = destino;
}

export const usandoClerk = USANDO_CLERK;

export const SessionProvider = USANDO_CLERK ? SessionProviderClerk : SessionProviderBypass;

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession debe usarse dentro de <SessionProvider>");
  return ctx;
}
