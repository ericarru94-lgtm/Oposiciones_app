/**
 * Diagnostica y (opcionalmente) repara el caso de un usuario duplicado por
 * un clerkUserId nuevo — típicamente tras migrar la instancia de Clerk de
 * Development a Production: Clerk asigna un clerkUserId distinto al mismo
 * email, y si `obtenerOCrearUsuarioDesdeClerk` no lo vincula por email (por
 * ejemplo porque la fila previa quedó huérfana antes del fix de
 * comparación insensible a mayúsculas en lib/clerkSync.ts, o por cualquier
 * otra causa), el login crea una segunda fila de Usuario en plan gratuito
 * en vez de reutilizar la que ya tenía la suscripción premium.
 *
 * Uso:
 *   npm run fusionar-duplicado -- <email>              # solo diagnóstico
 *   npm run fusionar-duplicado -- <email> --aplicar     # aplica la fusión si es segura
 *   npm run fusionar-duplicado -- <email> --aplicar --forzar   # aplica aunque la fila
 *                                                                # duplicada tenga progreso
 *
 * La fusión mueve el clerkUserId de la fila duplicada (sin datos de Stripe)
 * a la fila original (con stripeCustomerId/plan premium) y borra la fila
 * duplicada. Solo actúa cuando hay EXACTAMENTE 2 filas para el email y la
 * decisión de cuál es la "original" es inequívoca (una tiene
 * stripeCustomerId y la otra no) — en cualquier otro caso, solo informa y
 * no toca nada, para evitar borrar datos por error.
 */
import { prisma } from "../lib/prisma";

async function main() {
  const email = process.argv[2];
  const aplicar = process.argv.includes("--aplicar");
  const forzar = process.argv.includes("--forzar");

  if (!email) {
    console.error("Uso: npm run fusionar-duplicado -- <email> [--aplicar] [--forzar]");
    process.exitCode = 1;
    return;
  }

  const filas = await prisma.usuario.findMany({
    where: { email: { equals: email, mode: "insensitive" } },
    orderBy: { id: "asc" },
  });

  if (filas.length === 0) {
    console.log(`No hay ninguna fila de Usuario con email "${email}" (comparación insensible a mayúsculas).`);
    return;
  }

  console.log(`Filas encontradas para "${email}": ${filas.length}\n`);
  for (const fila of filas) {
    const [progreso, intentos, sesionesTest] = await Promise.all([
      prisma.progreso.count({ where: { usuarioId: fila.id } }),
      prisma.intento.count({ where: { usuarioId: fila.id } }),
      prisma.sesionTest.count({ where: { usuarioId: fila.id } }),
    ]);
    console.log(`- id=${fila.id}`);
    console.log(`  email real (case original en BD): ${fila.email}`);
    console.log(`  clerkUserId: ${fila.clerkUserId ?? "(ninguno)"}`);
    console.log(`  plan: ${fila.plan}   premiumHasta: ${fila.premiumHasta?.toISOString() ?? "(nunca)"}`);
    console.log(`  stripeCustomerId: ${fila.stripeCustomerId ?? "(ninguno)"}`);
    console.log(`  stripeSubscriptionId: ${fila.stripeSubscriptionId ?? "(ninguno)"}`);
    console.log(`  stripeSubscriptionStatus: ${fila.stripeSubscriptionStatus ?? "(ninguno)"}`);
    console.log(`  esAdmin: ${fila.esAdmin}`);
    console.log(`  progreso=${progreso}  intentos=${intentos}  sesionesTest=${sesionesTest}`);
    console.log("");
  }

  if (filas.length === 1) {
    console.log("Solo hay una fila: no hay nada que fusionar.");
    return;
  }

  if (filas.length > 2) {
    console.log(
      `Hay ${filas.length} filas (más de 2): esto no lo cubre este script, revisa manualmente cuál debe quedar.`
    );
    return;
  }

  const [a, b] = filas;
  const aTieneStripe = Boolean(a.stripeCustomerId);
  const bTieneStripe = Boolean(b.stripeCustomerId);

  if (aTieneStripe === bTieneStripe) {
    console.log(
      "No se puede decidir automáticamente cuál fila es la 'original': o ambas tienen stripeCustomerId, o ninguna. Resuélvelo a mano."
    );
    return;
  }

  const original = aTieneStripe ? a : b;
  const duplicado = aTieneStripe ? b : a;

  if (!duplicado.clerkUserId) {
    console.log(
      `La fila duplicada (id=${duplicado.id}) no tiene clerkUserId — no hay nada que trasladar. Revisa manualmente.`
    );
    return;
  }

  const [progresoDup, intentosDup, sesionesDup] = await Promise.all([
    prisma.progreso.count({ where: { usuarioId: duplicado.id } }),
    prisma.intento.count({ where: { usuarioId: duplicado.id } }),
    prisma.sesionTest.count({ where: { usuarioId: duplicado.id } }),
  ]);
  const duplicadoTieneDatos = progresoDup > 0 || intentosDup > 0 || sesionesDup > 0;

  console.log("Plan de fusión:");
  console.log(`  Original (se conserva): id=${original.id}  plan=${original.plan}  stripeCustomerId=${original.stripeCustomerId}`);
  console.log(`  Duplicado (se borra):   id=${duplicado.id}  clerkUserId=${duplicado.clerkUserId}`);
  console.log(`  -> el clerkUserId "${duplicado.clerkUserId}" pasará a la fila original.`);

  if (duplicadoTieneDatos) {
    console.log(
      `  AVISO: la fila duplicada tiene datos (progreso=${progresoDup}, intentos=${intentosDup}, sesionesTest=${sesionesDup}) que se perderán al borrarla — este script NO los traslada.`
    );
  }

  if (!aplicar) {
    console.log("\n(Diagnóstico únicamente — vuelve a ejecutar con --aplicar para aplicar este plan.)");
    return;
  }

  if (duplicadoTieneDatos && !forzar) {
    console.log(
      "\nAbortado: la fila duplicada tiene datos y no se pasó --forzar. Revisa si merece la pena conservarlos antes de forzar el borrado."
    );
    process.exitCode = 1;
    return;
  }

  const clerkUserIdNuevo = duplicado.clerkUserId;
  await prisma.$transaction([
    prisma.usuario.delete({ where: { id: duplicado.id } }),
    prisma.usuario.update({ where: { id: original.id }, data: { clerkUserId: clerkUserIdNuevo } }),
  ]);

  console.log(
    `\nHecho: fila duplicada (id=${duplicado.id}) borrada; fila original (id=${original.id}) ahora tiene clerkUserId="${clerkUserIdNuevo}".`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
