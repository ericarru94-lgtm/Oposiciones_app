// Servidor HTTP local que responde como PostgREST (cabeceras, estados y cuerpos
// reales de PostgREST v12). Sirve para probar la librería REAL
// (@supabase/supabase-js + @supabase/postgrest-js) sin tocar ningún Supabase:
// la librería hace peticiones HTTP de verdad y procesa respuestas de verdad.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export type SeenRequest = { method: string; path: string; query: URLSearchParams; headers: IncomingMessage["headers"]; body: string };
export type Handler = (req: SeenRequest, res: ServerResponse) => void;

export type FakePostgrest = {
  url: string;
  seen: SeenRequest[];
  setHandler(h: Handler): void;
  close(): Promise<void>;
};

export async function startFakePostgrest(initial: Handler = notFoundTable): Promise<FakePostgrest> {
  let handler = initial;
  const seen: SeenRequest[] = [];
  const sockets = new Set<import("node:net").Socket>();
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const u = new URL(req.url ?? "/", "http://local");
      const r = { method: req.method ?? "", path: u.pathname, query: u.searchParams, headers: req.headers, body };
      seen.push(r);
      handler(r, res);
    });
  });
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    seen,
    setHandler: (h) => (handler = h),
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}

/** Puerto local en el que no escucha nadie (conexión rechazada). */
export async function closedPortUrl(): Promise<string> {
  const s = createServer();
  await new Promise<void>((resolve) => s.listen(0, "127.0.0.1", resolve));
  const { port } = s.address() as AddressInfo;
  await new Promise<void>((resolve) => s.close(() => resolve()));
  return `http://127.0.0.1:${port}`;
}

export function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

/** Respuesta real de PostgREST v12 cuando la tabla no está en la caché del esquema. */
export const PGRST205 = {
  code: "PGRST205",
  details: null,
  hint: null,
  message: "Could not find the table 'public.mission_plans' in the schema cache",
};

export const notFoundTable: Handler = (req, res) => {
  // PostgREST responde 404 a HEAD sin cuerpo (HEAD no lleva cuerpo) y a GET con el JSON del error.
  if (req.method === "HEAD") {
    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end();
    return;
  }
  json(res, 404, PGRST205);
};

/** Tabla existente: GET de cero filas con recuento exacto (Content-Range «*\/total»). */
export const tableOk =
  (total: number, status: 200 | 206 = 200): Handler =>
  (req, res) => {
    if (req.method === "HEAD") {
      res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-range": `*/${total}` });
      res.end();
      return;
    }
    json(res, status, [], { "content-range": `*/${total}` });
  };
