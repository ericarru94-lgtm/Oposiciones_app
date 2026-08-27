import { clerkClient } from "@clerk/express";
import { prisma } from "./prisma";
import { esEmailAdmin } from "./adminEmails";
import type { Usuario } from "@prisma/client";

/**
 * Encuentra la fila de `Usuario` asociada a un usuario de Clerk ya
 * autenticado, creándola la primera vez que inicia sesión. El email se
 * obtiene siempre de Clerk (nunca lo manda el cliente); si ya existía una
 * fila con ese email (p.ej. de antes de migrar a Clerk), se enlaza en vez
 * de duplicarla. También reevalúa `esAdmin` en cada login, igual que hacía
 * `sincronizarEsAdmin` con el flujo de JWT: añadir un email a ADMIN_EMAILS
 * concede el acceso la próxima vez que esa persona inicie sesión.
 */
export async function obtenerOCrearUsuarioDesdeClerk(clerkUserId: string): Promise<Usuario> {
  const existente = await prisma.usuario.findUnique({ where: { clerkUserId } });
  if (existente) {
    if (!existente.esAdmin && esEmailAdmin(existente.email)) {
      return prisma.usuario.update({ where: { id: existente.id }, data: { esAdmin: true } });
    }
    return existente;
  }

  const usuarioClerk = await clerkClient.users.getUser(clerkUserId);
  const emailPrincipal = usuarioClerk.emailAddresses.find(
    (e) => e.id === usuarioClerk.primaryEmailAddressId
  );
  const email = emailPrincipal?.emailAddress ?? usuarioClerk.emailAddresses[0]?.emailAddress;
  if (!email) {
    throw new Error(`El usuario de Clerk ${clerkUserId} no tiene ningún email asociado`);
  }

  try {
    return await prisma.usuario.upsert({
      where: { email },
      create: { email, clerkUserId, esAdmin: esEmailAdmin(email) },
      update: { clerkUserId },
    });
  } catch (err) {
    // Carrera: otra petición concurrente del mismo usuario nuevo ganó y ya
    // creó la fila entre el findUnique de arriba y este upsert.
    const usuario = await prisma.usuario.findUnique({ where: { clerkUserId } });
    if (usuario) return usuario;
    throw err;
  }
}
