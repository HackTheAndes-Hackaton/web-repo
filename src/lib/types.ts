export type Role = "usuario" | "analista";

export type RiskLevel = "bajo" | "medio" | "alto";
export const RISK_LEVELS = ["bajo", "medio", "alto"] as const;

/**
 * Tipos de señal conocidos. El servicio de IA puede mandar otros: se guardan
 * tal cual y se muestran con su nombre crudo.
 */
export const SIGNAL_TYPES = [
  "urgencia",
  "dinero",
  "datos_sensibles",
  "secreto",
  "amenaza",
  "suplantacion",
  "aislamiento",
] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];

export const SIGNAL_LABELS: Record<string, string> = {
  urgencia: "Presión para actuar rápido",
  dinero: "Solicitud de dinero",
  datos_sensibles: "Solicitud de datos sensibles",
  secreto: "Exigencia de secreto",
  amenaza: "Amenaza o intimidación",
  suplantacion: "Posible suplantación de identidad",
  aislamiento: "Intento de aislar o mantener en línea",
};

export const ENTITY_KINDS = ["telefono", "cuenta", "monto", "nombre", "organizacion", "lugar"] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

export const ENTITY_LABELS: Record<string, string> = {
  telefono: "Teléfono",
  cuenta: "Cuenta / tarjeta",
  monto: "Monto",
  nombre: "Nombre",
  organizacion: "Organización",
  lugar: "Lugar",
};

export const PROVENANCE_LABELS: Record<string, string> = {
  mencionado: "Mencionado en la conversación",
  mostrado: "Mostrado en pantalla (identificador de llamada)",
  reportado_usuario: "Reportado por el usuario",
};

export const CHANNEL_LABELS: Record<string, string> = {
  llamada: "Llamada telefónica",
  app: "Aplicación móvil",
  presencial: "Conversación presencial",
  manual: "Captura manual",
};

export const signalLabel = (type: string) => SIGNAL_LABELS[type] ?? type;
export const entityLabel = (kind: string) => ENTITY_LABELS[kind] ?? kind;
export const provenanceLabel = (p: string) => PROVENANCE_LABELS[p] ?? p;
export const channelLabel = (c: string) => CHANNEL_LABELS[c] ?? c;

export type LinkStatus = "pendiente" | "confirmado" | "descartado";
export const LINK_STATUSES = ["pendiente", "confirmado", "descartado"] as const;
export type AnalystStatus = "nuevo" | "en_revision" | "cerrado";
export const ANALYST_STATUSES = ["nuevo", "en_revision", "cerrado"] as const;
export const NOTE_KINDS = ["correccion", "observacion", "conclusion"] as const;

export interface Session {
  userId: string;
  name: string;
  role: Role;
  orgId: string | null;
}

export interface Incident {
  id: string;
  external_id: string | null;
  user_id: string | null;
  org_id: string | null;
  title: string;
  channel: string;
  status: "en_curso" | "finalizado";
  started_at: string;
  ended_at: string | null;
  risk_score: number;
  risk_level: RiskLevel;
  summary: string | null;
  recommendation: string | null;
  analyst_status: AnalystStatus;
  created_at: string;
  updated_at: string;
}

export interface Segment {
  id: string;
  incident_id: string;
  idx: number;
  t_offset: number;
  speaker: string | null;
  text: string;
  created_at: string;
}

export interface Signal {
  id: string;
  incident_id: string;
  segment_id: string | null;
  type: string;
  evidence: string;
  explanation: string;
  confidence: number;
  source: string;
  created_at: string;
}

export interface Entity {
  id: string;
  incident_id: string;
  segment_id: string | null;
  kind: string;
  value: string;
  normalized: string;
  provenance: string;
  created_at: string;
}

export interface ActionLog {
  id: string;
  incident_id: string;
  kind: string;
  detail: string;
  created_at: string;
}

export interface Note {
  id: string;
  incident_id: string;
  author_id: string | null;
  author_name: string;
  author_role: string;
  kind: (typeof NOTE_KINDS)[number];
  text: string;
  created_at: string;
}

export interface LinkReason {
  kind: "voz" | "dato_compartido" | "contenido" | string;
  detail: string;
}

export interface IncidentLink {
  id: string;
  incident_a: string;
  incident_b: string;
  score: number;
  voice_sim: number | null;
  content_sim: number;
  reasons: LinkReason[];
  status: LinkStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  note: string | null;
  created_at: string;
}

export function riskLevelFromScore(score: number): RiskLevel {
  if (score >= 65) return "alto";
  if (score >= 35) return "medio";
  return "bajo";
}
