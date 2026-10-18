import "server-only";
import { db, newId, nowIso } from "./db";
import type { Session, Suspect } from "./types";

/**
 * Registro de presuntos responsables: un analista da un alias a los casos que
 * cree obra del mismo estafador. El alias sirve para llevar registro y
 * seguimiento; no identifica a una persona ni prueba un autor común.
 */

export interface SuspectSummary extends Suspect {
  case_count: number;
  first_call: string | null;
  last_call: string | null;
  numbers: string[];
  scam_types: string[];
}

export class SuspectError extends Error {}

export async function listSuspects(orgId: string) {
  const sql = await db();
  const rows = await sql<SuspectSummary[]>`
    select s.*, count(i.id)::int as case_count, min(i.started_at) as first_call, max(i.started_at) as last_call,
      coalesce(array_agg(distinct coalesce(i.caller_e164, i.caller_number_raw))
        filter (where coalesce(i.caller_e164, i.caller_number_raw) is not null), '{}') as numbers,
      coalesce(array_agg(distinct i.scam_type) filter (where i.scam_type is not null), '{}') as scam_types
    from suspects s left join incidents i on i.suspect_id = s.id and i.org_id = s.org_id
    where s.org_id = ${orgId}
    group by s.id
    order by s.status, max(i.started_at) desc nulls last, s.created_at desc`;
  return [...rows];
}

function cleanAlias(value: unknown) {
  const alias = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!alias) throw new SuspectError("Escribe un alias para el registro (p. ej. «Falso abogado Ramírez»).");
  if (alias.length > 80) throw new SuspectError("El alias admite hasta 80 caracteres.");
  return alias;
}

const cleanNotes = (value: unknown) => String(value ?? "").trim().slice(0, 2000);

/** Solo casos de la organización del analista. */
async function ownCases(orgId: string, ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) throw new SuspectError("Selecciona al menos un caso.");
  const sql = await db();
  const rows = await sql<{ id: string }[]>`select id from incidents where org_id = ${orgId} and id in ${sql(unique)}`;
  if (rows.length !== unique.length) throw new SuspectError("Algún caso no pertenece a tu organización.");
  return unique;
}

function aliasTaken(error: unknown) {
  return (error as { code?: string })?.code === "23505";
}

async function logCases(
  tx: Awaited<ReturnType<typeof db>>,
  session: Session,
  ids: string[],
  detail: string,
  payload: Record<string, unknown>,
) {
  if (!ids.length) return;
  await tx`insert into actions ${tx(ids.map((incident_id) => ({
    id: newId("act"), incident_id, kind: "suspect_assignment", detail,
    actor_id: session.userId, actor_kind: "analyst", result: "applied",
    payload: tx.json(payload as never), created_at: nowIso(),
  })))}`;
}

export async function createSuspect(session: Session, input: { alias: unknown; notes: unknown; incidentIds: string[] }) {
  const orgId = session.orgId!;
  const alias = cleanAlias(input.alias);
  const notes = cleanNotes(input.notes);
  const ids = await ownCases(orgId, input.incidentIds);
  const sql = await db();
  const id = newId("sus");
  try {
    await sql.begin(async (tx) => {
      await tx`insert into suspects (id, org_id, alias, notes, created_by, created_by_id, created_at, updated_at)
        values (${id}, ${orgId}, ${alias}, ${notes}, ${session.name}, ${session.userId}, ${nowIso()}, ${nowIso()})`;
      await tx`update incidents set suspect_id = ${id}, updated_at = ${nowIso()} where org_id = ${orgId} and id in ${tx(ids)}`;
      await logCases(tx as never, session, ids, `Asociado al presunto responsable «${alias}» por ${session.name}.`, { suspect_id: id, alias });
    });
  } catch (error) {
    if (aliasTaken(error)) throw new SuspectError(`Ya existe un registro llamado «${alias}». Agrega los casos a ese registro o usa otro alias.`);
    throw error;
  }
  return id;
}

export async function assignCases(session: Session, suspectId: string, incidentIds: string[]) {
  const orgId = session.orgId!;
  const ids = await ownCases(orgId, incidentIds);
  const sql = await db();
  const [suspect] = await sql<Suspect[]>`select * from suspects where id = ${suspectId} and org_id = ${orgId}`;
  if (!suspect) throw new SuspectError("El registro no existe.");
  await sql.begin(async (tx) => {
    await tx`update incidents set suspect_id = ${suspectId}, updated_at = ${nowIso()} where org_id = ${orgId} and id in ${tx(ids)}`;
    await tx`update suspects set updated_at = ${nowIso()} where id = ${suspectId}`;
    await logCases(tx as never, session, ids, `Asociado al presunto responsable «${suspect.alias}» por ${session.name}.`, { suspect_id: suspectId, alias: suspect.alias });
  });
}

export async function updateSuspect(
  session: Session,
  suspectId: string,
  input: { alias: unknown; notes: unknown; status: unknown },
) {
  const orgId = session.orgId!;
  const alias = cleanAlias(input.alias);
  const notes = cleanNotes(input.notes);
  const status = input.status === "descartado" ? "descartado" : "en_investigacion";
  const sql = await db();
  try {
    const rows = await sql`update suspects set alias = ${alias}, notes = ${notes}, status = ${status}, updated_at = ${nowIso()}
      where id = ${suspectId} and org_id = ${orgId} returning id`;
    if (!rows.length) throw new SuspectError("El registro no existe.");
  } catch (error) {
    if (aliasTaken(error)) throw new SuspectError(`Ya existe un registro llamado «${alias}».`);
    throw error;
  }
}

export async function unassignCase(session: Session, incidentId: string) {
  const orgId = session.orgId!;
  const sql = await db();
  await sql.begin(async (tx) => {
    const [row] = await tx<{ alias: string; suspect_id: string }[]>`
      select s.alias, s.id as suspect_id from incidents i join suspects s on s.id = i.suspect_id
      where i.id = ${incidentId} and i.org_id = ${orgId}`;
    if (!row) return;
    await tx`update incidents set suspect_id = null, updated_at = ${nowIso()} where id = ${incidentId} and org_id = ${orgId}`;
    await logCases(tx as never, session, [incidentId], `Quitado del presunto responsable «${row.alias}» por ${session.name}.`, { suspect_id: row.suspect_id, alias: row.alias, removed: true });
  });
}
