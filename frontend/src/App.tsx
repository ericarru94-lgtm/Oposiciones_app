import { BrowserRouter, Route, Routes } from "react-router-dom";
import { SessionProvider } from "./context/SessionContext";
import { RutaProtegida } from "./components/RutaProtegida";
import { RutaAdmin } from "./components/RutaAdmin";
import { Inicio } from "./pages/Inicio";
import { OnboardingFlow } from "./pages/onboarding/OnboardingFlow";
import { Login } from "./pages/Login";
import { Registro } from "./pages/Registro";
import { Home } from "./pages/Home";
import { RepasarHoy } from "./pages/RepasarHoy";
import { PracticarTema } from "./pages/PracticarTema";
import { ResumenTema } from "./pages/ResumenTema";
import { Progreso } from "./pages/Progreso";
import { Simulacro } from "./pages/Simulacro";
import { Perfil } from "./pages/Perfil";
import { Upgrade } from "./pages/Upgrade";
import { Revision } from "./pages/admin/Revision";
import { AvisoLegal } from "./pages/legal/AvisoLegal";
import { Privacidad } from "./pages/legal/Privacidad";
import { Terminos } from "./pages/legal/Terminos";
import { Cookies } from "./pages/legal/Cookies";
import { Contacto } from "./pages/Contacto";
import { NewsletterConfirmar } from "./pages/NewsletterConfirmar";
import { NewsletterBaja } from "./pages/NewsletterBaja";

export function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
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
            path="/admin/revision"
            element={
              <RutaAdmin>
                <Revision />
              </RutaAdmin>
            }
          />
        </Routes>
      </BrowserRouter>
    </SessionProvider>
  );
}
