// Crea (o vincula) la cuenta del administrador de HE Signal en Supabase y la
// añade a public.admins. Se ejecuta una sola vez desde tu ordenador:
//   ADMIN_PASSWORD='una-contraseña-larga' npm run admin:create
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
const email = process.env.ADMIN_EMAIL?.toLowerCase();
const password = process.env.ADMIN_PASSWORD;

if (!url || !secret || !email) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY o ADMIN_EMAIL en .env.local");
  process.exit(1);
}
if (!password || password.length < 12) {
  console.error("Define ADMIN_PASSWORD con al menos 12 caracteres (solo para este comando, no lo guardes).");
  process.exit(1);
}

const supabase = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

async function findUserId(): Promise<string | null> {
  for (let page = 1; page < 20; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const user = data.users.find((u) => u.email?.toLowerCase() === email);
    if (user) return user.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

let userId = await findUserId();
if (!userId) {
  const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  userId = data.user.id;
  console.log(`Usuario creado: ${email}`);
} else {
  console.log(`El usuario ${email} ya existía; se vincula como administrador.`);
}

const { error } = await supabase.from("admins").upsert({ user_id: userId, email });
if (error) throw error;
await supabase.from("activity_log").insert({ actor_type: "system", action: "admin.bootstrap", entity_type: "admin", entity_id: userId });
console.log("Listo. Ya puedes entrar en la oficina con ese email y contraseña.");
