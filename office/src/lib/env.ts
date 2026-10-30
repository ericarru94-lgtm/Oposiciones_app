import "server-only";
import { z } from "zod";
import { DEFAULT_MODEL, MODELS, type ModelId } from "./agents/registry";

// Variables de entorno del servidor. Las claves nunca se envían al navegador:
// la interfaz solo recibe si cada integración está configurada o no.

const optional = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .optional();

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: optional.pipe(z.url().optional()),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: optional,
  SUPABASE_SECRET_KEY: optional,
  ADMIN_EMAIL: optional.pipe(z.email().optional()),
  ANTHROPIC_API_KEY: optional,
  DEFAULT_AGENT_MODEL: optional,
  N8N_BASE_URL: optional.pipe(z.url().optional()),
  N8N_API_KEY: optional,
  N8N_WEBHOOK_SECRET: optional,
  LOCAL_PREVIEW: optional,
});

export type ServerEnv = z.infer<typeof schema>;

export function readEnv(source: Record<string, string | undefined> = process.env): ServerEnv {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Variables de entorno no válidas: ${fields}. Revisa .env.local (ver .env.example).`);
  }
  return parsed.data;
}

export function defaultModel(env: ServerEnv = readEnv()): ModelId {
  const m = env.DEFAULT_AGENT_MODEL;
  return m && Object.hasOwn(MODELS, m) ? (m as ModelId) : DEFAULT_MODEL;
}

export type AuthMode = "supabase" | "local-preview" | "not-configured";

/**
 * - supabase: Supabase configurado, se exige sesión de administrador.
 * - local-preview: sin Supabase, solo en desarrollo y con LOCAL_PREVIEW=1.
 *   Muestra la configuración de los agentes, sin datos ni acciones.
 * - not-configured: falta configuración; la app no muestra nada privado.
 */
export function authMode(env: ServerEnv = readEnv(), nodeEnv = process.env.NODE_ENV): AuthMode {
  if (env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY && env.ADMIN_EMAIL) {
    return "supabase";
  }
  if (nodeEnv !== "production" && env.LOCAL_PREVIEW === "1") return "local-preview";
  return "not-configured";
}

export interface IntegrationStatus {
  id: string;
  name: string;
  configured: boolean;
  required: boolean;
  detail: string;
}

export function integrationStatus(env: ServerEnv = readEnv()): IntegrationStatus[] {
  return [
    {
      id: "supabase",
      name: "Supabase (base de datos y login)",
      configured: Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
      required: true,
      detail: "NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    },
    {
      id: "supabase-secret",
      name: "Clave secreta de Supabase (ejecutor de agentes)",
      configured: Boolean(env.SUPABASE_SECRET_KEY),
      required: true,
      detail: "SUPABASE_SECRET_KEY · solo servidor",
    },
    {
      id: "admin",
      name: "Email del administrador",
      configured: Boolean(env.ADMIN_EMAIL),
      required: true,
      detail: "ADMIN_EMAIL",
    },
    {
      id: "anthropic",
      name: "API de Anthropic (Claude)",
      configured: Boolean(env.ANTHROPIC_API_KEY),
      required: true,
      detail: "ANTHROPIC_API_KEY · se usa a partir de la fase 3",
    },
    {
      id: "n8n",
      name: "n8n",
      configured: Boolean(env.N8N_BASE_URL && env.N8N_API_KEY),
      required: false,
      detail: "N8N_BASE_URL, N8N_API_KEY y N8N_WEBHOOK_SECRET · fase 5",
    },
  ];
}
