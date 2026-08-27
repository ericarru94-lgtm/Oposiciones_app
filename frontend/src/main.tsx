import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ClerkProvider } from '@clerk/clerk-react'
import './index.css'
import { App } from './App.tsx'

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined

const app = (
  <StrictMode>
    <App />
  </StrictMode>
)

createRoot(document.getElementById('root')!).render(
  // Sin la clave (modo E2E sin Clerk, ver context/SessionContext.tsx) no se
  // monta <ClerkProvider>: intentaría cargar el script de Clerk igualmente
  // y fallaría al no tener una clave válida.
  clerkPublishableKey ? (
    <ClerkProvider publishableKey={clerkPublishableKey}>{app}</ClerkProvider>
  ) : (
    app
  ),
)
