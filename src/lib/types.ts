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
  "premio",
  "familiaridad",
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
  premio: "Premio, sorteo o bono falso",
  familiaridad: "Saludo eufórico o familiaridad forzada",
};

export const ENTITY_KINDS = ["telefono", "cuenta", "cci", "billetera", "monto", "nombre", "organizacion", "lugar"] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

export const ENTITY_LABELS: Record<string, string> = {
  telefono: "Teléfono",
  cuenta: "Cuenta bancaria",
  cci: "Código de Cuenta Interbancario (CCI)",
  billetera: "Billetera digital",
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
  client_call_id: string | null;
  provider_call_id: string | null;
  agent_session_id: string | null;
  caller_number_raw: string | null;
  caller_e164: string | null;
  caller_name: string | null;
  direction: "incoming" | "outgoing" | null;
  call_status: "ringing" | "active" | "ended" | "rejected" | "missed" | null;
  answered_at: string | null;
  talk_duration_s: number | null;
  agent_status: string | null;
  ready_to_answer: boolean;
  simulated: boolean | null;
  blocked: boolean;
  analysis_status: "pending" | "running" | "completed" | "failed";
  verdict: "none" | "safe" | "suspicious" | "scam";
  risk_reasons: string[];
  scam_type: string | null;
  impersonating: string | null;
  user_feedback: "safe" | "scam" | "unsure" | null;
  user_feedback_at: string | null;
  consent_snapshot: Record<string, unknown>;
  analysis_meta: Record<string, unknown>;
  shared_at: string | null;
  sharing_revoked_at: string | null;
  /** Presunto responsable al que un analista asoció el caso (alias de registro). */
  suspect_id: string | null;
}

/** Alias que un analista da a un grupo de casos que cree obra del mismo estafador. No identifica a nadie. */
export interface Suspect {
  id: string;
  org_id: string;
  alias: string;
  notes: string;
  status: "en_investigacion" | "descartado";
  created_by: string | null;
  created_by_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Signal {
  id: string;
  incident_id: string;
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
  reviewed_by_id: string | null;
  evidence_version: number;
  evidence_snapshot: Record<string, unknown>;
  reviewed_evidence_version: number | null;
  reviewed_evidence: Record<string, unknown> | null;
}

export function riskLevelFromScore(score: number): RiskLevel {
  if (score >= 65) return "alto";
  if (score >= 35) return "medio";
  return "bajo";
}

/** Tipos de estafa conocidos. La IA puede mandar otros: se muestran legibles. */
export const SCAM_TYPE_LABELS: Record<string, string> = {
  familiar_falso: "Falso familiar",
  secuestro_virtual: "Secuestro virtual",
  suplantacion_bancaria: "Suplantación bancaria",
  premio_falso: "Premio falso",
  autoridad_falsa: "Falsa autoridad",
  cobro_falso: "Cobro falso",
  inversion: "Inversión falsa",
};

export function scamTypeLabel(type: string | null | undefined) {
  if (!type) return null;
  if (SCAM_TYPE_LABELS[type]) return SCAM_TYPE_LABELS[type];
  const text = type.replace(/[_-]+/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}
