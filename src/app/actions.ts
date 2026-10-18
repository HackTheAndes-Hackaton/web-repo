"use server";

import { cookies } from "next/headers";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { createApiKey, revokeApiKey } from "@/lib/api-keys";
import { db, resetDatabase } from "@/lib/db";
import { getSession, SESSION_COOKIE } from "@/lib/session";
import { inspectNetworkOrigin } from "@/lib/api/network-origin";
import { ApiError } from "@/lib/api/http";

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

export async function inspectNetworkOriginAction(id: string): Promise<{ error?: string; success?: string }> {
  const session = await analystSession();
  try {
    await inspectNetworkOrigin(session.orgId!, id, session.userId);
    refresh();
    return { success: "Metadatos actualizados. La IP original no está disponible en esta ruta." };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : "No se pudo consultar la procedencia de la llamada." };
  }
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
