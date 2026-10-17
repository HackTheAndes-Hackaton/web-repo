export type Role = "usuario" | "analista";

export type RiskLevel = "bajo" | "medio" | "alto";

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

export const SIGNAL_LABELS: Record<SignalType, string> = {
  urgencia: "Presión para actuar rápido",
  dinero: "Solicitud de dinero",
  datos_sensibles: "Solicitud de datos sensibles",
  secreto: "Exigencia de secreto",
  amenaza: "Amenaza o intimidación",
  suplantacion: "Posible suplantación de identidad",
  aislamiento: "Intento de aislar o mantener en línea",
};

export const ENTITY_KINDS = [
  "telefono",
  "cuenta",
  "monto",
  "nombre",
  "organizacion",
  "lugar",
] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

export const ENTITY_LABELS: Record<EntityKind, string> = {
  telefono: "Teléfono",
  cuenta: "Cuenta / tarjeta",
  monto: "Monto",
  nombre: "Nombre",
  organizacion: "Organización",
  lugar: "Lugar",
};

export type Provenance = "mencionado" | "mostrado" | "reportado_usuario";

export const PROVENANCE_LABELS: Record<Provenance, string> = {
  mencionado: "Mencionado en la conversación",
  mostrado: "Mostrado en pantalla",
  reportado_usuario: "Reportado por el usuario",
};

export type Channel = "navegador" | "manual";

export const CHANNEL_LABELS: Record<Channel, string> = {
  navegador: "Micrófono del dispositivo",
  manual: "Captura manual",
};

export type LinkStatus = "pendiente" | "confirmado" | "descartado";
export type AnalystStatus = "nuevo" | "en_revision" | "cerrado";

export interface Session {
  userId: string;
  name: string;
  role: Role;
  orgId: string | null;
}

export interface Incident {
  id: string;
  user_id: string;
  title: string;
  channel: Channel;
  status: "en_curso" | "finalizado";
  started_at: string;
  ended_at: string | null;
  risk_score: number;
  risk_level: RiskLevel;
  summary: string | null;
  recommendation: string | null;
  shared_org_id: string | null;
  shared_at: string | null;
  analyst_status: AnalystStatus;
}

export interface Segment {
  id: string;
  incident_id: string;
  idx: number;
  t_offset: number;
  text: string;
  created_at: string;
}

export interface Signal {
  id: string;
  incident_id: string;
  segment_id: string | null;
  type: SignalType;
  evidence: string;
  explanation: string;
  confidence: number;
  source: "ia" | "reglas";
  created_at: string;
}

export interface Entity {
  id: string;
  incident_id: string;
  segment_id: string | null;
  kind: EntityKind;
  value: string;
  normalized: string;
  provenance: Provenance;
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
  author_id: string;
  author_name: string;
  author_role: Role;
  kind: "correccion" | "observacion" | "conclusion";
  text: string;
  created_at: string;
}

export interface LinkReason {
  kind: "voz" | "dato_compartido" | "contenido";
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
