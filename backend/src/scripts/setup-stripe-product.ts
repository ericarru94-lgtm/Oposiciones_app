/**
 * Crea (una sola vez) el producto "Premium mensual" y su precio recurrente
 * en Stripe. Idempotente: usa un `lookup_key` estable en el Price para
 * detectar si ya existe antes de crear uno nuevo, así que se puede volver
 * a ejecutar sin duplicar nada.
 *
 * Uso: npm run stripe:setup-producto
 * Requiere STRIPE_SECRET_KEY en backend/.env (modo test/sandbox).
 */
import "dotenv/config";
import { obtenerStripe } from "../lib/stripe";

const stripe = obtenerStripe();

const LOOKUP_KEY = "premium-mensual";
const NOMBRE_PRODUCTO = "Aprobox — Premium mensual";
const DESCRIPCION_PRODUCTO =
  "Preguntas ilimitadas y repaso por repetición espaciada sin restricciones del límite diario.";
const PRECIO_CENTIMOS = 499; // 4,99 €
const MONEDA = "eur";

async function main() {
  const existentes = await stripe.prices.list({ lookup_keys: [LOOKUP_KEY], limit: 1, active: true });
  if (existentes.data.length > 0) {
    const precio = existentes.data[0];
    console.log(`Ya existe un precio activo con lookup_key="${LOOKUP_KEY}": ${precio.id}`);
    console.log(`STRIPE_PRICE_ID=${precio.id}`);
    return;
  }

  const producto = await stripe.products.create({
    name: NOMBRE_PRODUCTO,
    description: DESCRIPCION_PRODUCTO,
  });

  const precio = await stripe.prices.create({
    product: producto.id,
    currency: MONEDA,
    unit_amount: PRECIO_CENTIMOS,
    recurring: { interval: "month" },
    lookup_key: LOOKUP_KEY,
  });

  console.log(`Producto creado: ${producto.id} (${NOMBRE_PRODUCTO})`);
  console.log(`Precio creado: ${precio.id} (${(PRECIO_CENTIMOS / 100).toFixed(2)} ${MONEDA.toUpperCase()}/mes)`);
  console.log(`\nAñade esto a backend/.env:\nSTRIPE_PRICE_ID=${precio.id}`);
}

main().catch((err) => {
  console.error("Error creando el producto/precio en Stripe:", err.message ?? err);
  process.exitCode = 1;
});
