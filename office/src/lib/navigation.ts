export interface NavItem {
  href: string;
  label: string;
  short: string;
  /** Fase en la que la sección pasa a funcionar de verdad. */
  phase: number;
}

export const NAV: readonly NavItem[] = [
  { href: "/", label: "Oficina", short: "Oficina", phase: 1 },
  { href: "/centro", label: "Centro de mando", short: "Mando", phase: 1 },
  { href: "/tareas", label: "Encargos", short: "Encargos", phase: 1 },
  { href: "/reuniones", label: "Sala de reuniones", short: "Reuniones", phase: 3 },
  { href: "/crm", label: "Clientes y CRM", short: "CRM", phase: 4 },
  { href: "/configuracion", label: "Configuración", short: "Ajustes", phase: 1 },
];
