import Stripe from "stripe";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

if (!STRIPE_SECRET_KEY) {
  throw new Error(
    "Falta STRIPE_SECRET_KEY en el entorno. Copia backend/.env.example a .env y añade tus claves de Stripe (modo test)."
  );
}

export const stripe = new Stripe(STRIPE_SECRET_KEY);
