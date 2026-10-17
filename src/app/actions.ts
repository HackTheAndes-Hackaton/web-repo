"use server";

import { cookies } from "next/headers";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { createApiKey, revokeApiKey } from "@/lib/api-keys";
import { db, nowIso, resetDatabase } from "@/lib/db";
import { emit } from "@/lib/events";
import { addNote, canView, getIncident, getLink } from "@/lib/repo";
import { getSession, SESSION_COOKIE } from "@/lib/session";
import { ANALYST_STATUSES, NOTE_KINDS, type AnalystStatus, type LinkStatus, type Note } from "@/lib/types";

export async function selectDemoUser(formData: FormData) {
  const userId = String(formData.get("userId") ?? "");
  const sql = await db();
  const [row] = await sql<{ role: string }[]>`select role from users where id = ${userId}`;
  if (row?.role !== "analista") return;
  (await cookies()).set(SESSION_COOKIE, userId, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect("/panel");
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/");
}

async function analystSession() {
  const s = await getSession();
  if (!s || s.role !== "analista" || !s.orgId) throw new Error("Se requiere una sesión de analista.");
  return s;
}

export async function addNoteAction(incidentId: string, formData: FormData) {
  const s = await analystSession();
  const inc = await getIncident(incidentId);
  if (!inc || !canView(s, inc)) return;
  const text = String(formData.get("text") ?? "").trim();
  const kind = String(formData.get("kind") ?? "observacion") as Note["kind"];
  if (!text || !NOTE_KINDS.includes(kind)) return;
  await addNote(incidentId, s, kind, text.slice(0, 2000));
  emit({ type: "incident", orgId: inc.org_id, incidentId });
  refresh();
}

export async function setAnalystStatus(incidentId: string, status: AnalystStatus) {
  const s = await analystSession();
  const inc = await getIncident(incidentId);
  if (!inc || !canView(s, inc) || !ANALYST_STATUSES.includes(status)) return;
  const sql = await db();
  await sql`update incidents set analyst_status = ${status}, updated_at = ${nowIso()} where id = ${incidentId}`;
  emit({ type: "incident", orgId: inc.org_id, incidentId });
  refresh();
}

export async function reviewLink(linkId: string, status: LinkStatus, formData?: FormData) {
  const s = await analystSession();
  const link = await getLink(linkId);
  if (!link) return;
  const [a, b] = await Promise.all([getIncident(link.incident_a), getIncident(link.incident_b)]);
  if (!a || !b || !canView(s, a) || !canView(s, b)) return;
  const note = formData ? String(formData.get("note") ?? "").trim() || null : null;
  const reviewed = status !== "pendiente";
  const sql = await db();
  await sql`update links set status = ${status}, reviewed_by = ${reviewed ? s.name : null},
            reviewed_at = ${reviewed ? nowIso() : null}, note = coalesce(${note}, note)
            where id = ${linkId}`;
  emit({ type: "links", orgId: s.orgId! });
  refresh();
}

export interface CreatedKey {
  key?: string;
  name?: string;
  error?: string;
}

/** Crea una clave de API. La clave completa solo se devuelve aquí, una vez. */
export async function createApiKeyAction(_prev: CreatedKey, formData: FormData): Promise<CreatedKey> {
  await analystSession();
  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  if (!name) return { error: "Ponle un nombre a la clave (p. ej. «Servidor de llamadas»)." };
  const { key } = await createApiKey(name);
  refresh();
  return { key, name };
}

export async function revokeApiKeyAction(id: string) {
  await analystSession();
  await revokeApiKey(id);
  refresh();
}

/** Solo para la demo: vuelve a cargar los datos ficticios (conserva las claves de API). */
export async function resetDemo() {
  await resetDatabase();
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/");
}
