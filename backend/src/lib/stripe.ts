import Stripe from "stripe";

let cliente: Stripe | null = null;

/**
 * Cliente de Stripe con inicialización perezosa: importar este módulo NO
 * requiere STRIPE_SECRET_KEY (así el backend arranca normalmente en
 * dev/test/E2E sin esa variable); solo falla al intentar usarlo de
 * verdad, con un 500 capturado por asyncHandler en vez de tumbar el
 * arranque del servidor entero.
 */
export function obtenerStripe(): Stripe {
  if (!cliente) {
    const clave = process.env.STRIPE_SECRET_KEY;
    if (!clave) {
      throw new Error(
        "Falta STRIPE_SECRET_KEY en el entorno. Copia backend/.env.example a .env y añade tus claves de Stripe (modo test)."
      );
    }
    cliente = new Stripe(clave);
  }
  return cliente;
}
