# Instalación de HE SIGNAL AI OFFICE

Pasos cortos. Se hacen una sola vez.

## 1. Crear el proyecto de Supabase
1. Entra en https://supabase.com/dashboard con la cuenta de la agencia.
2. **New project** → nombre `he-signal-office`, región **West EU (Ireland)** o **Central EU (Frankfurt)**, plan **Free**. Guarda la contraseña de la base de datos.
3. **Authentication → Sign In / Providers**: desactiva **Allow new users to sign up** (solo existirá la cuenta del administrador).

(Si me das permiso, también puedo crearlo yo con la conexión de Supabase.)

## 2. Crear las tablas
En **SQL Editor** ejecuta, en este orden:
1. El contenido de `supabase/migrations/0001_init.sql`.
2. El contenido de `supabase/seed.sql` (los 9 empleados y la memoria inicial de la agencia).

## 3. Variables de entorno
Copia `.env.example` a `.env.local` y rellena:
- `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` → **Project Settings → API Keys** (publishable).
- `SUPABASE_SECRET_KEY` → la clave **secret** (`sb_secret_…`). No la compartas.
- `ADMIN_EMAIL` → el email con el que entrarás.

## 4. Crear la cuenta de administrador
```bash
cd office
npm install
ADMIN_PASSWORD='una-contraseña-larga-y-única' npm run admin:create
```

## 5. Arrancar
```bash
npm run dev      # http://localhost:3000
npm run check    # tipos + pruebas
```
Sin Supabase puedes ver la interfaz con `LOCAL_PREVIEW=1 npm run dev` (solo en tu ordenador; en producción no funciona).

## 6. Publicar en Vercel (cuando quieras)
Nuevo proyecto desde este repositorio con **Root Directory = `office`** y las mismas variables de entorno.
