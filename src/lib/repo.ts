import "server-only";
import { db, newId, nowIso } from "./db";
import type {
  ActionLog,
  Entity,
  Incident,
  IncidentLink,
  Note,
  RiskLevel,
  Segment,
  Session,
  Signal,
  SignalType,
} from "./types";

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
  a_title: string;
  b_title: string;
  a_started: string;
  b_started: string;
  a_risk: RiskLevel;
  b_risk: RiskLevel;
}

export async function listLinks(orgId: string) {
  const sql = await db();
  const rows = await sql<LinkView[]>`
    select l.*, a.title as a_title, b.title as b_title, a.started_at as a_started,
           b.started_at as b_started, a.risk_level as a_risk, b.risk_level as b_risk
    from links l join incidents a on a.id = l.incident_a join incidents b on b.id = l.incident_b
    where a.org_id = ${orgId} and b.org_id = ${orgId}
    order by case l.status when 'pendiente' then 0 when 'confirmado' then 1 else 2 end, l.score desc`;
  return [...rows];
}

export async function getLink(id: string) {
  const sql = await db();
  const [row] = await sql<IncidentLink[]>`select * from links where id = ${id}`;
  return row as IncidentLink | undefined;
}

export async function getIncidentDetail(id: string, session: Session) {
  const sql = await db();
  const incident = await getIncident(id);
  if (!incident || !canView(session, incident)) return null;
  const [segments, signals, entities, actions, notes, [{ n: voiceSamples }], [owner], sharedOrg, links] =
    await Promise.all([
      sql<Segment[]>`select * from segments where incident_id = ${id} order by idx`,
      sql<Signal[]>`select * from signals where incident_id = ${id} order by created_at`,
      sql<Entity[]>`select * from entities where incident_id = ${id} order by kind, value`,
      sql<ActionLog[]>`select * from actions where incident_id = ${id} order by created_at`,
      sql<Note[]>`select * from notes where incident_id = ${id} order by created_at`,
      sql<{ n: number }[]>`select count(*)::int as n from voice_samples where incident_id = ${id}`,
      incident.user_id
        ? sql<{ name: string }[]>`select name from users where id = ${incident.user_id}`
        : Promise.resolve([] as { name: string }[]),
      incident.org_id ? getOrg(incident.org_id) : Promise.resolve(undefined),
      incident.org_id
        ? listLinks(incident.org_id).then((all) => all.filter((l) => l.incident_a === id || l.incident_b === id))
        : Promise.resolve([] as LinkView[]),
    ]);
  return {
    incident,
    segments: [...segments],
    signals: [...signals],
    entities: [...entities],
    actions: [...actions],
    notes: [...notes],
    voiceSamples,
    owner,
    sharedOrg,
    links,
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
    links,
    riskDist,
    period: {
      cases: { now: week.length, prev: prevWeek.length },
      high: {
        now: week.filter((i) => i.risk_level === "alto").length,
        prev: prevWeek.filter((i) => i.risk_level === "alto").length,
      },
    },
    attention: {
      newHigh: incidents.filter((i) => i.analyst_status === "nuevo" && i.risk_level === "alto").length,
      newCases: incidents.filter((i) => i.analyst_status === "nuevo").length,
      inReview: incidents.filter((i) => i.analyst_status === "en_revision").length,
      closed: incidents.filter((i) => i.analyst_status === "cerrado").length,
    },
    kpis: {
      total: incidents.length,
      high: incidents.filter((i) => i.risk_level === "alto").length,
      inReview: incidents.filter((i) => i.analyst_status !== "cerrado").length,
      pendingLinks: links.filter((l) => l.status === "pendiente").length,
      confirmedLinks: links.filter((l) => l.status === "confirmado").length,
    },
    byDay: [...byDay.entries()].map(([day, counts]) => ({ day, ...counts })),
    signalCounts: [...signalCounts],
    repeatedEntities: [...repeatedEntities],
  };
}

/** Contadores para la barra lateral del analista. */
export async function navCounts(orgId: string) {
  const sql = await db();
  const [[{ open }], [{ pending }]] = await Promise.all([
    sql<{ open: number }[]>`
      select count(*)::int as open from incidents where org_id = ${orgId} and analyst_status != 'cerrado'`,
    sql<{ pending: number }[]>`
      select count(*)::int as pending from links l
      join incidents a on a.id = l.incident_a join incidents b on b.id = l.incident_b
      where l.status = 'pendiente' and a.org_id = ${orgId} and b.org_id = ${orgId}`,
  ]);
  return { open, pendingLinks: pending };
}

/** Código corto y legible para citar un caso. */
export function caseCode(id: string) {
  return `#${id.replace(/^inc_/, "").slice(0, 5).toUpperCase()}`;
}

export async function addNote(incidentId: string, session: Session, kind: Note["kind"], text: string) {
  const sql = await db();
  await sql`insert into notes (id, incident_id, author_id, author_name, author_role, kind, text, created_at)
            values (${newId("not")}, ${incidentId}, ${session.userId}, ${session.name}, ${session.role},
                    ${kind}, ${text}, ${nowIso()})`;
}
