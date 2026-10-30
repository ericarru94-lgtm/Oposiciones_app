# HE SIGNAL AI OFFICE

Oficina virtual con nueve empleados de IA para dirigir HE Signal Agency.

- Arquitectura, costes y fases: [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md)
- Instalación paso a paso: [`docs/INSTALACION.md`](docs/INSTALACION.md)

## Estructura
- `src/lib/agents/` · los 9 empleados (`registry.ts`), herramientas y riesgos (`tools.ts`), permisos (`permissions.ts`), reglas comunes (`prompts.ts`) y memoria inicial (`company-memory.ts`)
- `src/lib/domain/status.ts` · estados de agentes y máquina de estados de tareas
- `src/lib/data/` · acceso a datos (solo servidor)
- `src/app/` · interfaz (Next.js App Router); `src/proxy.ts` protege las rutas
- `supabase/` · migración con RLS y seed generado (`npm run db:seed`)
- `tests/` · pruebas (incluye la migración real en PostgreSQL embebido)

## Comandos
`npm run dev` · `npm run check` · `npm run build` · `npm run db:seed` · `npm run admin:create`
