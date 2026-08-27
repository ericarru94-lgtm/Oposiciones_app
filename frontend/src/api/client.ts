// `||` (no `??`): un VITE_API_URL definido pero vacío (p.ej. mal copiado al
// configurar Vercel) debe caer también al valor por defecto, no quedarse
// como cadena vacía — eso convertiría toda petición en una ruta relativa
// al propio dominio del frontend en vez de al backend.
const BASE_URL = ((import.meta.env.VITE_API_URL as string | undefined) || "http://localhost:3001/api").replace(
  /\/+$/,
  ""
);

if (import.meta.env.PROD && !/^https?:\/\//.test(BASE_URL)) {
  // VITE_API_URL debe ser el origen completo del backend (https://tu-servicio.onrender.com/api),
  // nunca una ruta relativa (p.ej. "/api") — si no, esto queda mudo en consola
  // y las peticiones fallan con un "Unexpected token '<'" críptico (ver
  // apiFetch más abajo) porque acaban golpeando el propio dominio del
  // frontend en vez del backend. Ver backend/docs/despliegue.md.
  console.error(
    `VITE_API_URL ("${BASE_URL}") no parece una URL absoluta. Debe incluir "https://" y el dominio del backend, no una ruta relativa.`
  );
}

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    const mensaje =
      body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string"
        ? (body as { error: string }).error
        : `Error de API (${status})`;
    super(mensaje);
    this.status = status;
    this.body = body;
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  token?: string | null;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      // La causa más habitual es VITE_API_URL mal configurada (vacía o
      // relativa): la petición acaba golpeando el propio dominio del
      // frontend, que responde con el index.html de la SPA en vez de con
      // la API — de ahí el "Unexpected token '<'" de JSON.parse si se deja
      // sin capturar. Ver backend/docs/despliegue.md.
      throw new Error(
        `Respuesta no válida de ${BASE_URL}${path} (¿VITE_API_URL mal configurada? revisa que apunte al backend, no al propio frontend)`
      );
    }
  }

  if (!res.ok) {
    throw new ApiError(res.status, data);
  }
  return data as T;
}
