import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { iniciarSesion, obtenerUsuarioActual, registrarUsuario } from "../api/endpoints";
import type { Usuario } from "../api/types";

const CLAVE_TOKEN = "oposiciones:token";
const CLAVE_SESION_ANONIMA = "oposiciones:sesionAnonima";
const CLAVE_NIVEL_PENDIENTE = "oposiciones:nivelInicialPendiente";
const CLAVE_ONBOARDING_COMPLETO = "oposiciones:onboardingCompleto";

function generarSesionAnonima(): string {
  return crypto.randomUUID();
}

interface SessionContextValue {
  token: string | null;
  usuario: Usuario | null;
  cargando: boolean;
  /** Identificador estable del visitante anónimo, usado para el mini-test y el límite diario antes de registrarse. */
  sesionAnonima: string;
  /** Nivel de partida elegido en el onboarding, guardado hasta que haya cuenta donde persistirlo. */
  nivelInicialPendiente: string | null;
  setNivelInicialPendiente: (nivel: string) => void;
  onboardingCompleto: boolean;
  marcarOnboardingCompleto: () => void;
  registrar: (email: string, password: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(CLAVE_TOKEN));
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [cargando, setCargando] = useState(true);
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

  useEffect(() => {
    if (!token) {
      setCargando(false);
      return;
    }
    obtenerUsuarioActual(token)
      .then(setUsuario)
      .catch(() => {
        localStorage.removeItem(CLAVE_TOKEN);
        setToken(null);
      })
      .finally(() => setCargando(false));
  }, [token]);

  const setNivelInicialPendiente = useCallback((nivel: string) => {
    localStorage.setItem(CLAVE_NIVEL_PENDIENTE, nivel);
    setNivelInicialPendienteState(nivel);
  }, []);

  const marcarOnboardingCompleto = useCallback(() => {
    localStorage.setItem(CLAVE_ONBOARDING_COMPLETO, "1");
    setOnboardingCompleto(true);
  }, []);

  const registrar = useCallback(
    async (email: string, password: string) => {
      const respuesta = await registrarUsuario({
        email,
        password,
        nivelInicial: nivelInicialPendiente ?? undefined,
        sesionAnonima,
      });
      localStorage.setItem(CLAVE_TOKEN, respuesta.token);
      localStorage.removeItem(CLAVE_NIVEL_PENDIENTE);
      setToken(respuesta.token);
      setUsuario(respuesta.usuario);
    },
    [nivelInicialPendiente, sesionAnonima]
  );

  const login = useCallback(
    async (email: string, password: string) => {
      const respuesta = await iniciarSesion({ email, password, sesionAnonima });
      localStorage.setItem(CLAVE_TOKEN, respuesta.token);
      setToken(respuesta.token);
      setUsuario(respuesta.usuario);
    },
    [sesionAnonima]
  );

  const logout = useCallback(() => {
    localStorage.removeItem(CLAVE_TOKEN);
    setToken(null);
    setUsuario(null);
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      token,
      usuario,
      cargando,
      sesionAnonima,
      nivelInicialPendiente,
      setNivelInicialPendiente,
      onboardingCompleto,
      marcarOnboardingCompleto,
      registrar,
      login,
      logout,
    }),
    [
      token,
      usuario,
      cargando,
      sesionAnonima,
      nivelInicialPendiente,
      setNivelInicialPendiente,
      onboardingCompleto,
      marcarOnboardingCompleto,
      registrar,
      login,
      logout,
    ]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession debe usarse dentro de <SessionProvider>");
  return ctx;
}
