import { BrowserRouter, Route, Routes } from "react-router-dom";
import { SessionProvider } from "./context/SessionContext";
import { RutaProtegida } from "./components/RutaProtegida";
import { Inicio } from "./pages/Inicio";
import { OnboardingFlow } from "./pages/onboarding/OnboardingFlow";
import { Login } from "./pages/Login";
import { Home } from "./pages/Home";
import { RepasarHoy } from "./pages/RepasarHoy";
import { PracticarTema } from "./pages/PracticarTema";
import { Progreso } from "./pages/Progreso";
import { Upgrade } from "./pages/Upgrade";

export function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Inicio />} />
          <Route path="/onboarding" element={<OnboardingFlow />} />
          <Route path="/login" element={<Login />} />
          <Route path="/upgrade" element={<Upgrade />} />
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
            path="/progreso"
            element={
              <RutaProtegida>
                <Progreso />
              </RutaProtegida>
            }
          />
        </Routes>
      </BrowserRouter>
    </SessionProvider>
  );
}
