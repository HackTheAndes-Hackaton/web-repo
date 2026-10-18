export interface MaritimeReport {
  summary: string;
  recommendation: string;
  modality: string | null;
  limitations: string[];
  signals: {type: string; explanation: string; confidence: number; source: string; analysis_meta: Record<string, unknown>}[];
  entities: {kind: string; value: string; provenance: "mencionado"; analysis_meta: Record<string, unknown>}[];
  generation: {provider: "maritime"; prompt_version: "pe-report-v1"; model_id: string; usage: Record<string, number>};
}
export const DEFAULT_MARITIME_MODEL: string;
export function maritimeReportConfig(options?:{agentId?:string;apiKey?:string;model?:string}):{agentId:string|undefined;apiKey:string|undefined;model:string;configured:boolean;endpoint:string|null};
export function generateMaritimeReport(context:string,options?:{agentId?:string;apiKey?:string;model?:string;fetch?:typeof fetch;timeoutMs?:number}):Promise<MaritimeReport>;
export function reportSegments(context:string):{id:string;text:string;start:number}[];
export function validateReport(raw:unknown,segments:{id:string;text:string;start:number}[]):Omit<MaritimeReport,"generation">;
