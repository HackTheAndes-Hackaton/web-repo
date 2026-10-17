"use server";

import { cookies } from "next/headers";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { db, nowIso, resetDatabase } from "@/lib/db";
import { emit } from "@/lib/events";
import { endIncident, processSegment, setSharing, startIncident } from "@/lib/pipeline";
import { addNote, canView, getActiveIncident, getIncident, getLink, getOrg, logAction } from "@/lib/repo";
import { getSession, SESSION_COOKIE } from "@/lib/session";
import type { AnalystStatus, Channel, LinkStatus, Note } from "@/lib/types";

export async function selectDemoUser(formData: FormData) {
  const userId = String(formData.get("userId") ?? "");
  const sql = await db();
  const [row] = await sql<{ role: string }[]>`select role from users where id = ${userId}`;
  if (!row) return;
  (await cookies()).set(SESSION_COOKIE, userId, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect(row.role === "analista" ? "/panel" : "/app");
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/");
}

async function userSession() {
  const s = await getSession();
  if (!s || s.role !== "usuario") throw new Error("Se requiere una sesión de usuario.");
  return s;
}

async function analystSession() {
  const s = await getSession();
  if (!s || s.role !== "analista" || !s.orgId) throw new Error("Se requiere una sesión de analista.");
  return s;
}

/** Inicia una captura; si había otra en curso, la cierra primero. */
export async function startCapture(channel: Channel) {
  const s = await userSession();
  const active = await getActiveIncident(s.userId);
  if (active) await endIncident(active.id);
  const incidentId = await startIncident(s.userId, channel);
  refresh();
  return incidentId;
}

export async function stopCapture(incidentId: string) {
  const s = await userSession();
  const inc = await getIncident(incidentId);
  if (!inc || inc.user_id !== s.userId) return;
  await endIncident(incidentId);
  refresh();
}

/** Texto transcrito en el dispositivo (Web Speech API) o escrito a mano durante la demo. */
export async function sendTranscript(incidentId: string, text: string, channel: Channel = "navegador") {
  const s = await userSession();
  const inc = await getIncident(incidentId);
  if (!inc || inc.user_id !== s.userId || inc.status !== "en_curso") return { ok: false as const };
  if (!text.trim()) return { ok: false as const };
  const { analysis } = await processSegment(incidentId, {
    text: text.slice(0, 2000),
    provenance: channel === "manual" ? "reportado_usuario" : "mencionado",
  });
  refresh();
  return { ok: true as const, engine: analysis?.source, error: analysis?.error };
}

export async function shareIncident(incidentId: string, orgId: string | null) {
  const s = await userSession();
  const inc = await getIncident(incidentId);
  if (!inc || inc.user_id !== s.userId) return;
  if (orgId && !(await getOrg(orgId))) return;
  await setSharing(incidentId, orgId);
  refresh();
}

export async function deleteIncident(incidentId: string) {
  const s = await userSession();
  const inc = await getIncident(incidentId);
  if (!inc || inc.user_id !== s.userId) return;
  const sql = await db();
  await sql`delete from incidents where id = ${incidentId}`;
  emit({ type: "incident", userId: s.userId, orgId: inc.shared_org_id, incidentId });
  if (inc.shared_org_id) emit({ type: "links", orgId: inc.shared_org_id });
  redirect("/app");
}

export async function deleteVoiceSamples(incidentId: string) {
  const s = await userSession();
  const inc = await getIncident(incidentId);
  if (!inc || inc.user_id !== s.userId) return;
  const sql = await db();
  await sql.begin(async (tx) => {
    await tx`delete from voice_samples where incident_id = ${incidentId}`;
    await logAction(incidentId, "voz_borrada", "El usuario borró las muestras de voz de este incidente.", tx);
  });
  if (inc.shared_org_id) await setSharing(incidentId, inc.shared_org_id); // recalcula vínculos sin la voz
  refresh();
}

export async function addNoteAction(incidentId: string, formData: FormData) {
  const s = await getSession();
  if (!s) return;
  const inc = await getIncident(incidentId);
  if (!inc || !canView(s, inc)) return;
  const text = String(formData.get("text") ?? "").trim();
  const kind = String(formData.get("kind") ?? "observacion") as Note["kind"];
  if (!text || !["correccion", "observacion", "conclusion"].includes(kind)) return;
  if (kind === "conclusion" && s.role !== "analista") return;
  await addNote(incidentId, s, kind, text.slice(0, 2000));
  emit({ type: "incident", userId: inc.user_id, orgId: inc.shared_org_id, incidentId });
  refresh();
}

export async function setAnalystStatus(incidentId: string, status: AnalystStatus) {
  const s = await analystSession();
  const inc = await getIncident(incidentId);
  if (!inc || !canView(s, inc)) return;
  const sql = await db();
  await sql`update incidents set analyst_status = ${status} where id = ${incidentId}`;
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

/** Solo para la demo: vuelve a cargar los datos ficticios. */
export async function resetDemo() {
  await resetDatabase();
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/");
}
