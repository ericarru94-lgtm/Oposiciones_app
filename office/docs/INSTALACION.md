# Instalación de HE SIGNAL AI OFFICE

Uso personal y gratuito (plan Free de Supabase).

## Ya hecho (30/10/2026)
- Proyecto de Supabase **he-signal-office** (`bgptbtmyhtobqohkoeyd`, Irlanda, plan Free) en la organización «ericarru94-lgtm's Org».
- Migraciones aplicadas (`supabase/migrations/0001…0003`) y datos iniciales (`supabase/seed.sql`): 9 empleados y 8 entradas de memoria.
- `hesignalagency@gmail.com` está en la lista de administradores permitidos: cuando exista esa cuenta, se convierte en administrador automáticamente.
- Revisión de seguridad de Supabase: sin avisos pendientes salvo uno intencionado (`is_admin()` la necesitan las reglas de acceso; solo responde sí/no sobre uno mismo).

## Lo que falta (lo haces tú, 2 minutos, se puede desde el móvil)
1. Abre https://supabase.com/dashboard/project/bgptbtmyhtobqohkoeyd/auth/users
2. **Add user → Create new user**: email `hesignalagency@gmail.com`, una contraseña larga que solo sepas tú y marca **Auto Confirm User**.
3. Ve a **Authentication → Sign In / Providers** y desactiva **Allow new users to sign up**.

## Variables de entorno
`.env.local` (no se sube a GitHub):
```
NEXT_PUBLIC_SUPABASE_URL=https://bgptbtmyhtobqohkoeyd.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key: Project Settings → API Keys>
ADMIN_EMAIL=hesignalagency@gmail.com
```
`SUPABASE_SECRET_KEY` y `ANTHROPIC_API_KEY` se añadirán en la fase 3.

## Arrancar en un ordenador
```bash
cd office && npm install && npm run dev   # http://localhost:3000
```

## Usarla desde el móvil
Publicada en **https://he-signal-office.vercel.app** (Vercel Hobby, proyecto `he-signal-office`, Root Directory `office`). Las variables de entorno ya están configuradas en Vercel.

## Notas del plan gratuito
- Supabase Free pausa el proyecto tras 7 días sin uso; se reactiva desde el panel con un clic.
- La única parte con coste será la IA (fase 3): la API de Anthropic se paga por uso, no tiene plan gratuito.
