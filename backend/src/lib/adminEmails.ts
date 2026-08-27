/**
 * Bootstrap de administradores sin necesidad de tocar la base de datos a
 * mano: cualquier email listado en ADMIN_EMAILS (separados por comas)
 * obtiene `Usuario.esAdmin = true` la próxima vez que se registre o inicie
 * sesión (ver `sincronizarEsAdmin` en routes/auth.ts). Quitar un email de
 * la lista NO revoca el acceso ya concedido; para revocarlo hay que poner
 * `esAdmin=false` directamente en la fila (no hay endpoint para esto,
 * deliberadamente: es una herramienta de un único admin, no un panel de
 * gestión de roles).
 */
export function esEmailAdmin(email: string): boolean {
  const lista = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return lista.includes(email.toLowerCase());
}
