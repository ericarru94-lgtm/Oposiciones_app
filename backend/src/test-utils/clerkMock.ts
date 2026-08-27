import { vi } from "vitest";

/**
 * Mock de "@clerk/express" para los tests de integración: en vez de
 * verificar una sesión real, toma tal cual el valor que llega en el header
 * `Authorization: Bearer <valor>` como si ya fuera el `clerkUserId` — los
 * tests fabrican identidades con un string cualquiera y las registran aquí
 * con `mockUsuarioClerk()` antes de usarlas, igual que antes fabricaban un
 * JWT. Se usa con `vi.mock("@clerk/express", () => import(".../clerkMock"))`
 * en cada archivo de test que necesite autenticación.
 */

const emailsPorClerkUserId = new Map<string, string>();

export function mockUsuarioClerk(clerkUserId: string, email: string) {
  emailsPorClerkUserId.set(clerkUserId, email);
}

export const clerkClient = {
  users: {
    getUser: vi.fn(async (clerkUserId: string) => {
      const email = emailsPorClerkUserId.get(clerkUserId);
      if (!email) {
        throw new Error(
          `Usuario de Clerk desconocido en el mock: "${clerkUserId}". Regístralo antes con mockUsuarioClerk().`
        );
      }
      return {
        emailAddresses: [{ id: "email_mock", emailAddress: email }],
        primaryEmailAddressId: "email_mock",
      };
    }),
  },
};

export function clerkMiddleware() {
  return (req: any, _res: any, next: any) => {
    const header = req.headers.authorization as string | undefined;
    const userId = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
    req.auth = () => ({ userId });
    next();
  };
}

export function getAuth(req: any) {
  return req.auth();
}
