// Distribución de la oficina 3D (solo presentación). Es independiente de
// `agents.desk` del registro, que se vuelca al seed de la base de datos y no
// se toca: la escena coloca cada puesto aquí.
//
// Coordenadas en metros de escena. La cámara isométrica mira desde +x/+z, así
// que los puestos se orientan para que el personaje mire hacia ella.

export type StationProp =
  | "glassOffice" | "wallScreen" | "bookshelf" | "dualMonitor" | "tripleMonitor" | "phone" | "funnelBoard"
  | "campaignBoard" | "paperStack" | "deskLamp" | "drawingTablet" | "moodBoard" | "serverRack" | "headsetStand"
  | "filingCabinet" | "chartBoard" | "checklistBoard" | "plant";

export type ScreenKind = "org" | "crm" | "campaign" | "text" | "design" | "code" | "support" | "finance" | "qa";

export interface Station {
  agentId: string;
  /** Centro del puesto. */
  x: number;
  z: number;
  /** Giro en Y del puesto: 0 = el personaje mira hacia -z. */
  rotation: number;
  zone: { label: string; w: number; d: number; dx?: number; dz?: number };
  screen: ScreenKind;
  props: StationProp[];
  /** Mesa más ancha (dirección). */
  wide?: boolean;
}

/** Mirando hacia la cámara (+z) o hacia el pasillo central (+x). */
const FACE_CAMERA = Math.PI;
const FACE_AISLE = -Math.PI / 2;

export const OFFICE_SIZE = { w: 26, d: 20 } as const;

export const STATIONS: readonly Station[] = [
  // Fondo: despacho de dirección acristalado.
  { agentId: "alex", x: 0, z: -6.4, rotation: FACE_CAMERA, wide: true, screen: "org",
    zone: { label: "Dirección", w: 6.4, d: 4.6 }, props: ["glassOffice", "wallScreen", "bookshelf", "plant"] },
  // Ala izquierda (mira al pasillo central).
  { agentId: "marcus", x: -8.6, z: -4.4, rotation: FACE_AISLE, screen: "crm",
    zone: { label: "Comercial", w: 5, d: 4.2 }, props: ["dualMonitor", "phone", "funnelBoard"] },
  { agentId: "sofia", x: -8.6, z: 0.6, rotation: FACE_AISLE, screen: "campaign",
    zone: { label: "Marketing", w: 5, d: 4.2 }, props: ["campaignBoard", "plant"] },
  { agentId: "daniel", x: -8.6, z: 5.6, rotation: FACE_AISLE, screen: "text",
    zone: { label: "Contenidos", w: 5, d: 4.2 }, props: ["bookshelf", "paperStack", "deskLamp"] },
  // Frente (mira a la cámara).
  { agentId: "lucia", x: -3, z: 6.6, rotation: FACE_CAMERA, screen: "design",
    zone: { label: "Creatividad", w: 4.6, d: 4 }, props: ["drawingTablet", "moodBoard", "plant"] },
  { agentId: "oscar", x: 3, z: 6.6, rotation: FACE_CAMERA, screen: "finance",
    zone: { label: "Finanzas y datos", w: 4.6, d: 4 }, props: ["filingCabinet", "chartBoard"] },
  // Ala derecha.
  { agentId: "david", x: 8.6, z: -4.4, rotation: FACE_CAMERA, screen: "code",
    zone: { label: "Automatización e IA", w: 5, d: 4.2 }, props: ["tripleMonitor", "serverRack"] },
  { agentId: "emma", x: 8.6, z: 0.6, rotation: FACE_CAMERA, screen: "support",
    zone: { label: "Atención al cliente", w: 5, d: 4.2 }, props: ["headsetStand", "phone", "plant"] },
  { agentId: "victoria", x: 8.6, z: 5.6, rotation: FACE_CAMERA, screen: "qa",
    zone: { label: "Control de calidad", w: 5, d: 4.2 }, props: ["checklistBoard", "deskLamp"] },
];

export function stationOf(agentId: string): Station | undefined {
  return STATIONS.find((s) => s.agentId === agentId);
}

/** Sala de reuniones en el centro de la planta. */
export const MEETING = { x: 0, z: 0.4, w: 4.2, d: 2.2 } as const;

/** Punto al que mira la cámara al acercarse a un puesto (algo por delante del personaje). */
export function focusPoint(s: Station): [number, number, number] {
  return [s.x, 0.9, s.z];
}
