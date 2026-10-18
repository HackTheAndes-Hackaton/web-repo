export interface LinkExplanationContext {
  case_a:{summary:string};
  case_b:{summary:string};
  reasons:{index:number;kind:string;label:string}[];
}
export interface LinkExplanation {
  behavior_similarity:'similar'|'unclear'|'different';
  evidence_a:string|null;
  evidence_b:string|null;
  supporting_reason_indexes:number[];
  limitations:string[];
  generation:{provider:'maritime';prompt_version:'pe-link-v1';model_id:string;usage:Record<string,number>};
}
export const LINK_PROMPT_VERSION:string;
export function validateLinkExplanation(context:LinkExplanationContext,remote:unknown):LinkExplanation;
export function generateMaritimeLinkExplanation(context:LinkExplanationContext,
  options?:{agentId?:string;apiKey?:string;model?:string;fetch?:typeof fetch;timeoutMs?:number}):Promise<LinkExplanation>;
