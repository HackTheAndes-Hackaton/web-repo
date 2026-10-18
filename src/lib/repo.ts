import "server-only";
import { db } from "./db";
import { buildLinkGroups, type GroupIncident } from "./link-groups";
import type {
  ActionLog,
  Entity,
  Incident,
  IncidentLink,
  RiskLevel,
  Session,
  Signal,
  SignalType,
} from "./types";
import type { TranscriptLine } from "./api/calls";

export async function getIncident(id: string) {
  const sql = await db();
  const [row] = await sql<Incident[]>`select * from incidents where id = ${id}`;
  return row as Incident | undefined;
}

/** Un analista solo ve los incidentes de su organización. */
export function canView(session: Session, incident: Incident) {
  return session.role === "analista" && Boolean(session.orgId) && incident.org_id === session.orgId;
}

export async function getOrg(id: string) {
  const sql = await db();
  const [row] = await sql<{ id: string; name: string }[]>`select * from organizations where id = ${id}`;
  return row as { id: string; name: string } | undefined;
}

export interface IncidentSummary extends Incident {
  signal_count: number;
  signal_types: string | null;
  user_name: string | null;
}

export async function listSharedIncidents(orgId: string) {
  const sql = await db();
  const rows = await sql<IncidentSummary[]>`
    select i.*, u.name as user_name,
           (select count(*)::int from signals s where s.incident_id = i.id) as signal_count,
           (select string_agg(distinct s.type, ',') from signals s where s.incident_id = i.id) as signal_types
    from incidents i left join users u on u.id = i.user_id
    where i.org_id = ${orgId}
    order by i.started_at desc`;
  return [...rows];
}

export interface LinkView extends IncidentLink {
  explanation_eligible: boolean;
  a_title: string;
  b_title: string;
  a_started: string;
  b_started: string;
  a_risk: RiskLevel;
  b_risk: RiskLevel;
  a_scam_type: string | null;
  b_scam_type: string | null;
  a_impersonating: string | null;
  b_impersonating: string | null;
  a_caller: string | null;
  b_caller: string | null;
}

export async function listLinks(orgId: string) {
  const sql = await db();
  const rows = await sql<LinkView[]>`
    select l.*, a.title as a_title, b.title as b_title, a.started_at as a_started,
           b.started_at as b_started, a.risk_level as a_risk, b.risk_level as b_risk,
           a.scam_type as a_scam_type, b.scam_type as b_scam_type,
           a.impersonating as a_impersonating, b.impersonating as b_impersonating,
           coalesce(a.caller_e164, a.caller_number_raw) as a_caller, coalesce(b.caller_e164, b.caller_number_raw) as b_caller,
           (a.simulated is true and b.simulated is true and a.sharing_revoked_at is null and b.sharing_revoked_at is null
             and a.consent_snapshot->>'report_storage'='true' and b.consent_snapshot->>'report_storage'='true'
             and a.consent_snapshot->>'report_sharing'='true' and b.consent_snapshot->>'report_sharing'='true'
             and a.analysis_meta->'report_generation'->>'status'='completed'
             and b.analysis_meta->'report_generation'->>'status'='completed'
             and a.analysis_meta->'report_generation'->>'provider'='maritime'
             and b.analysis_meta->'report_generation'->>'provider'='maritime'
             and nullif(trim(a.summary),'') is not null and nullif(trim(b.summary),'') is not null) as explanation_eligible
    from links l join incidents a on a.id = l.incident_a join incidents b on b.id = l.incident_b
    where a.org_id = ${orgId} and b.org_id = ${orgId} and l.status <> 'descartado'
    order by l.score desc`;
  return [...rows];
}

export async function getIncidentDetail(id: string, session: Session) {
  const sql = await db();
  const incident = await getIncident(id);
  if (!incident || !canView(session, incident)) return null;
  const [transcript, signals, entities, actions, [{ n: voiceSamples }], [owner], sharedOrg, allLinks, groupCases] =
    await Promise.all([
      sql<TranscriptLine[]>`select id, idx, speaker, text, flagged, t_offset, external_segment_id
        from segments where incident_id = ${id} order by idx, created_at`,
      sql<Signal[]>`select * from signals where incident_id = ${id} order by created_at`,
      sql<Entity[]>`select * from entities where incident_id = ${id} order by kind, value`,
      sql<ActionLog[]>`select * from actions where incident_id = ${id}
        or link_id in (select id from links where incident_a=${id} or incident_b=${id}) order by created_at`,
      sql<{ n: number }[]>`select count(*)::int as n from voice_samples where incident_id = ${id}`,
      incident.user_id
        ? sql<{ name: string }[]>`select name from users where id = ${incident.user_id}`
        : Promise.resolve([] as { name: string }[]),
      incident.org_id ? getOrg(incident.org_id) : Promise.resolve(undefined),
      incident.org_id
        ? listLinks(incident.org_id)
        : Promise.resolve([] as LinkView[]),
      incident.org_id
        ? sql<(GroupIncident & { title: string; started_at: string })[]>`
          select id,org_id,simulated,sharing_revoked_at,title,started_at from incidents where org_id=${incident.org_id}`
        : Promise.resolve([] as (GroupIncident & { title: string; started_at: string })[]),
    ]);
  const [suspect] = incident.suspect_id
    ? await sql<{ id: string; alias: string; status: string }[]>`
        select id, alias, status from suspects where id = ${incident.suspect_id} and org_id = ${incident.org_id}`
    : [];
  const relatedGroup = buildLinkGroups([...groupCases], allLinks).find((group) => group.incidentIds.includes(id)) ?? null;
  const links = relatedGroup?.links.filter((link) => link.incident_a === id || link.incident_b === id) ?? [];
  const members = new Set(relatedGroup?.incidentIds);
  const direct = new Set(links.map((link) => link.incident_a === id ? link.incident_b : link.incident_a));
  const relatedCases = groupCases.filter((item) => item.id !== id && members.has(item.id))
    .map((item) => ({ id: item.id, title: item.title, started_at: item.started_at, direct: direct.has(item.id) }))
    .sort((a, b) => Number(b.direct) - Number(a.direct) || a.started_at.localeCompare(b.started_at));
  return {
    incident,
    transcript: [...transcript],
    signals: [...signals],
    entities: [...entities],
    actions: [...actions],
    voiceSamples,
    owner,
    sharedOrg,
    links,
    relatedGroup,
    relatedCases,
    suspect: suspect ?? null,
  };
}

export type IncidentDetail = NonNullable<Awaited<ReturnType<typeof getIncidentDetail>>>;

export async function dashboardData(orgId: string) {
  const sql = await db();
  const [incidents, links, signalCounts, repeatedEntities] = await Promise.all([
    listSharedIncidents(orgId),
    listLinks(orgId),
    sql<{ type: SignalType; n: number }[]>`
      select s.type, count(distinct s.incident_id)::int as n from signals s
      join incidents i on i.id = s.incident_id where i.org_id = ${orgId}
      group by s.type order by n desc`,
    sql<{ kind: string; normalized: string; value: string; n: number }[]>`
      select e.kind, e.normalized, min(e.value) as value, count(distinct e.incident_id)::int as n
      from entities e join incidents i on i.id = e.incident_id
      where i.org_id = ${orgId} and e.kind in ('telefono', 'cuenta', 'nombre')
      group by e.kind, e.normalized having count(distinct e.incident_id) > 1
      order by n desc limit 8`,
  ]);

  const groups = buildLinkGroups(incidents, links);
  const connections = groups.flatMap((group) => group.links).sort((a, b) => b.score - a.score);
  const byDay = new Map<string, Record<RiskLevel, number>>();
  // Últimos 14 días, incluidos los días sin casos.
  for (let i = 13; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    byDay.set(day, { bajo: 0, medio: 0, alto: 0 });
  }
  for (const inc of incidents) {
    const bucket = byDay.get(inc.started_at.slice(0, 10));
    if (bucket) bucket[inc.risk_level] += 1;
  }

  // Comparación de los últimos 7 días contra los 7 anteriores.
  const now = Date.now();
  const inWindow = (iso: string, fromDays: number, toDays: number) => {
    const t = Date.parse(iso);
    return t > now - fromDays * 86400000 && t <= now - toDays * 86400000;
  };
  const week = incidents.filter((i) => inWindow(i.started_at, 7, 0));
  const prevWeek = incidents.filter((i) => inWindow(i.started_at, 14, 7));

  const riskDist = (["alto", "medio", "bajo"] as RiskLevel[]).map((level) => ({
    level,
    n: incidents.filter((i) => i.risk_level === level).length,
  }));

  return {
    incidents,
    links: connections,
    riskDist,
    period: {
      cases: { now: week.length, prev: prevWeek.length },
      high: {
        now: week.filter((i) => i.risk_level === "alto").length,
        prev: prevWeek.filter((i) => i.risk_level === "alto").length,
      },
    },
    scamTypes: countBy(incidents.map((i) => i.scam_type)),
    impersonated: countBy(incidents.map((i) => i.impersonating)),
    kpis: {
      total: incidents.length,
      high: incidents.filter((i) => i.risk_level === "alto").length,
      scams: incidents.filter((i) => i.verdict === "scam").length,
      links: connections.length,
      groups: groups.length,
    },
    byDay: [...byDay.entries()].map(([day, counts]) => ({ day, ...counts })),
    signalCounts: [...signalCounts],
    repeatedEntities: [...repeatedEntities],
  };
}

/** Valores no vacíos agrupados y ordenados de mayor a menor. */
function countBy(values: (string | null)[]) {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].map(([value, n]) => ({ value, n })).sort((a, b) => b.n - a.n);
}

/** Contadores para la barra lateral del analista. */
export async function navCounts(orgId: string) {
  const sql = await db();
  const [incidents, links] = await Promise.all([
    sql<GroupIncident[]>`select id,org_id,simulated,sharing_revoked_at from incidents where org_id = ${orgId}`,
    sql<Pick<IncidentLink,"id" | "incident_a" | "incident_b" | "status">[]>`
      select l.id,l.incident_a,l.incident_b,l.status from links l
      join incidents a on a.id = l.incident_a join incidents b on b.id = l.incident_b
      where l.status <> 'descartado' and a.org_id = ${orgId} and b.org_id = ${orgId}`,
  ]);
  const groups = buildLinkGroups([...incidents], [...links]);
  return { cases: incidents.length, links: groups.reduce((total, group) => total + group.links.length, 0), groups: groups.length };
}

/** Código corto y legible para citar un caso. */
export function caseCode(id: string) {
  return `#${id.replace(/^inc_/, "").slice(0, 5).toUpperCase()}`;
}

