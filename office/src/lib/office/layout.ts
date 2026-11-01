// Distribución de la sede 3D (solo presentación). Independiente de
// `agents.desk` del registro, que se vuelca al seed de la base de datos.
//
// Planta de 40 × 30 m con pasillos de 4 m: despacho de dirección al fondo,
// alas laterales por departamento, sala de reuniones acristalada en el centro
// y zona de descanso. La cámara isométrica mira desde +x/+z, así que los
// puestos se orientan para que el trabajador mire hacia ella o al pasillo.

export type StationProp =
  | "glassOffice" | "videoWall" | "bookshelf" | "phone" | "funnelBoard" | "campaignBoard" | "paperStack"
  | "deskLamp" | "drawingTablet" | "moodBoard" | "serverRack" | "headsetStand" | "filingCabinet"
  | "chartBoard" | "checklistBoard" | "plant" | "laptop" | "kpiTotem";

export type ScreenKind = "org" | "crm" | "campaign" | "text" | "design" | "code" | "support" | "finance" | "qa";

export interface Station {
  agentId: string;
  x: number;
  z: number;
  /** Giro en Y del puesto: 0 = el trabajador mira hacia -z. */
  rotation: number;
  zone: { label: string; w: number; d: number; dx?: number; dz?: number };
  /** Pantalla principal y, si la hay, secundaria. */
  screen: ScreenKind;
  second?: ScreenKind;
  props: StationProp[];
  /** Mesa ejecutiva (dirección). */
  executive?: boolean;
}

const FACE_CAMERA = Math.PI;

export const OFFICE_SIZE = { w: 40, d: 30 } as const;

export const STATIONS: readonly Station[] = [
  // Fondo: despacho de dirección acristalado con videowall.
  { agentId: "alex", x: 0, z: -10.2, rotation: FACE_CAMERA, executive: true, screen: "org", second: "finance",
    zone: { label: "Dirección", w: 11, d: 7.4 }, props: ["glassOffice", "videoWall", "bookshelf", "plant", "laptop"] },
  // Ala oeste (mira al pasillo central).
  { agentId: "marcus", x: -14, z: -7.5, rotation: FACE_CAMERA, screen: "crm", second: "crm",
    zone: { label: "Comercial", w: 8.4, d: 6.4 }, props: ["phone", "funnelBoard", "plant", "kpiTotem"] },
  { agentId: "sofia", x: -14, z: 0, rotation: FACE_CAMERA, screen: "campaign", second: "finance",
    zone: { label: "Marketing", w: 8.4, d: 6.4 }, props: ["campaignBoard", "laptop", "plant"] },
  { agentId: "daniel", x: -14, z: 7.5, rotation: FACE_CAMERA, screen: "text",
    zone: { label: "Contenidos", w: 8.4, d: 6.4 }, props: ["bookshelf", "paperStack", "deskLamp"] },
  // Frente (mira a la cámara).
  { agentId: "lucia", x: -5.2, z: 11.2, rotation: FACE_CAMERA, screen: "design", second: "design",
    zone: { label: "Creatividad", w: 8.2, d: 6 }, props: ["drawingTablet", "moodBoard", "plant"] },
  { agentId: "oscar", x: 5.2, z: 11.2, rotation: FACE_CAMERA, screen: "finance", second: "finance",
    zone: { label: "Finanzas y datos", w: 8.2, d: 6 }, props: ["filingCabinet", "chartBoard"] },
  // Ala este (mira a la cámara).
  { agentId: "david", x: 14, z: -7.5, rotation: FACE_CAMERA, screen: "code", second: "code",
    zone: { label: "Automatización e IA", w: 8.4, d: 6.4 }, props: ["serverRack", "laptop"] },
  { agentId: "emma", x: 14, z: 0, rotation: FACE_CAMERA, screen: "support",
    zone: { label: "Atención al cliente", w: 8.4, d: 6.4 }, props: ["headsetStand", "phone", "plant"] },
  { agentId: "victoria", x: 14, z: 7.5, rotation: FACE_CAMERA, screen: "qa",
    zone: { label: "Control de calidad", w: 8.4, d: 6.4 }, props: ["checklistBoard", "deskLamp"] },
];

export function stationOf(agentId: string): Station | undefined {
  return STATIONS.find((s) => s.agentId === agentId);
}

/** Sala de reuniones acristalada en el centro de la planta. */
export const MEETING = { x: 0, z: 0.4, w: 9, d: 6 } as const;

/** Zona de descanso junto a la entrada (esquina frontal derecha). */
export const LOUNGE = { x: 14, z: 12.9, w: 7, d: 3.6 } as const;

/** Punto al que mira la cámara al acercarse a un puesto. */
export function focusPoint(s: Station): [number, number, number] {
  return [s.x, 1, s.z];
}

/** Accesos rápidos de cámara por departamento, en orden de lectura. */
export const QUICK_FOCUS = ["alex", "marcus", "sofia", "daniel", "lucia", "oscar", "david", "emma", "victoria"] as const;
