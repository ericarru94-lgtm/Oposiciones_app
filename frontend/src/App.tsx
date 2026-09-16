import { lazy, Suspense, useEffect, useRef } from "react";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { SessionProvider } from "./context/SessionContext";
import { RutaProtegida } from "./components/RutaProtegida";
import { RutaAdmin } from "./components/RutaAdmin";
import { PantallaCargando } from "./components/PantallaCargando";
import { AvisoCookies } from "./components/AvisoCookies";
import { registrarVistaPagina } from "./lib/analytics";
import { Inicio } from "./pages/Inicio";

/**
 * Todo lo que no sea la landing va con import dinámico: con un import
 * estático de cada página, el bundle inicial (lo que descarga cualquiera
 * que visite "/", el punto de entrada SEO/marketing) incluía el código de
 * cada pantalla de la app entera — simulacro, admin, onboarding, páginas
 * legales... aunque esa visita nunca las use. `Inicio` (y la landing que
 * renderiza) se queda con import estático a propósito: es la página que
 * más importa cargar rápido, y no arrastra nada pesado.
 */
const OnboardingFlow = lazy(() =>
  import("./pages/onboarding/OnboardingFlow").then((m) => ({ default: m.OnboardingFlow }))
);
const Login = lazy(() => import("./pages/Login").then((m) => ({ default: m.Login })));
const Registro = lazy(() => import("./pages/Registro").then((m) => ({ default: m.Registro })));
const Home = lazy(() => import("./pages/Home").then((m) => ({ default: m.Home })));
const RepasarHoy = lazy(() => import("./pages/RepasarHoy").then((m) => ({ default: m.RepasarHoy })));
const PracticarTema = lazy(() => import("./pages/PracticarTema").then((m) => ({ default: m.PracticarTema })));
const ResumenTema = lazy(() => import("./pages/ResumenTema").then((m) => ({ default: m.ResumenTema })));
const Progreso = lazy(() => import("./pages/Progreso").then((m) => ({ default: m.Progreso })));
const Simulacro = lazy(() => import("./pages/Simulacro").then((m) => ({ default: m.Simulacro })));
const ExamenOficial = lazy(() => import("./pages/ExamenOficial").then((m) => ({ default: m.ExamenOficial })));
const Perfil = lazy(() => import("./pages/Perfil").then((m) => ({ default: m.Perfil })));
const Upgrade = lazy(() => import("./pages/Upgrade").then((m) => ({ default: m.Upgrade })));
const Revision = lazy(() => import("./pages/admin/Revision").then((m) => ({ default: m.Revision })));
const AvisoLegal = lazy(() => import("./pages/legal/AvisoLegal").then((m) => ({ default: m.AvisoLegal })));
const Privacidad = lazy(() => import("./pages/legal/Privacidad").then((m) => ({ default: m.Privacidad })));
const Terminos = lazy(() => import("./pages/legal/Terminos").then((m) => ({ default: m.Terminos })));
const Cookies = lazy(() => import("./pages/legal/Cookies").then((m) => ({ default: m.Cookies })));
const Contacto = lazy(() => import("./pages/Contacto").then((m) => ({ default: m.Contacto })));
const NewsletterConfirmar = lazy(() =>
  import("./pages/NewsletterConfirmar").then((m) => ({ default: m.NewsletterConfirmar }))
);
const NewsletterBaja = lazy(() => import("./pages/NewsletterBaja").then((m) => ({ default: m.NewsletterBaja })));

/**
 * Manda una vista de página a Analytics en cada cambio de ruta DENTRO de
 * la SPA — la primera ya la manda gtag.js solo en su propio `config`
 * (ver lib/analytics.ts), así que aquí se ignora a propósito el primer
 * montaje para no contarla dos veces.
 */
function SeguimientoAnalytics() {
  const location = useLocation();
  const esPrimeraVez = useRef(true);
  useEffect(() => {
    if (esPrimeraVez.current) {
      esPrimeraVez.current = false;
      return;
    }
    registrarVistaPagina(location.pathname + location.search);
  }, [location.pathname, location.search]);
  return null;
}

export function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <SeguimientoAnalytics />
        <Suspense fallback={<PantallaCargando />}>
          <Routes>
            <Route path="/" element={<Inicio />} />
            <Route path="/onboarding" element={<OnboardingFlow />} />
            <Route path="/login" element={<Login />} />
            <Route path="/registro" element={<Registro />} />
            <Route path="/upgrade" element={<Upgrade />} />
            <Route path="/aviso-legal" element={<AvisoLegal />} />
            <Route path="/privacidad" element={<Privacidad />} />
            <Route path="/terminos" element={<Terminos />} />
            <Route path="/cookies" element={<Cookies />} />
            <Route path="/contacto" element={<Contacto />} />
            <Route path="/newsletter/confirmar" element={<NewsletterConfirmar />} />
            <Route path="/newsletter/baja" element={<NewsletterBaja />} />
            <Route
              path="/perfil"
              element={
                <RutaProtegida>
                  <Perfil />
                </RutaProtegida>
              }
            />
            <Route
              path="/home"
              element={
                <RutaProtegida>
                  <Home />
                </RutaProtegida>
              }
            />
            <Route
              path="/repasar-hoy"
              element={
                <RutaProtegida>
                  <RepasarHoy />
                </RutaProtegida>
              }
            />
            <Route
              path="/practicar/:temaId"
              element={
                <RutaProtegida>
                  <PracticarTema />
                </RutaProtegida>
              }
            />
            <Route
              path="/temas/:temaId/resumen"
              element={
                <RutaProtegida>
                  <ResumenTema />
                </RutaProtegida>
              }
            />
            <Route
              path="/progreso"
              element={
                <RutaProtegida>
                  <Progreso />
                </RutaProtegida>
              }
            />
            <Route
              path="/simulacro"
              element={
                <RutaProtegida>
                  <Simulacro />
                </RutaProtegida>
              }
            />
            <Route
              path="/simulacro/examen-oficial"
              element={
                <RutaProtegida>
                  <ExamenOficial />
                </RutaProtegida>
              }
            />
            <Route
              path="/admin/revision"
              element={
                <RutaAdmin>
                  <Revision />
                </RutaAdmin>
              }
            />
          </Routes>
        </Suspense>
        <AvisoCookies />
      </BrowserRouter>
    </SessionProvider>
  );
}
