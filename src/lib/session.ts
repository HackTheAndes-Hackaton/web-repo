import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { db } from "./db";
import type { Role, Session } from "./types";

export const SESSION_COOKIE = "demo_session";

/**
 * Sesión de demostración: la cookie guarda el id de un usuario sembrado.
 * En producción se reemplaza por autenticación real.
 */
export async function getSession(): Promise<Session | null> {
  // Los datos vienen de Supabase y cambian en cada solicitud: nunca se prerenderizan.
  await connection();
  const id = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!id) return null;
  const sql = await db();
  const [row] = await sql<{ id: string; name: string; role: Role; org_id: string | null }[]>`
    select id, name, role, org_id from users where id = ${id}`;
  if (!row) return null;
  return { userId: row.id, name: row.name, role: row.role, orgId: row.org_id };
}

export async function requireSession(role: Role): Promise<Session> {
  const session = await getSession();
  if (!session || session.role !== role) redirect("/");
  return session;
}

export function sessionError(role?: Role) {
  return Response.json(
    { error: role ? `Se requiere una sesión de ${role}.` : "Sesión requerida." },
    { status: 401 },
  );
}
