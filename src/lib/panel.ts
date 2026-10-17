import "server-only";
import { requireSession } from "./session";

/** Sesión de analista con organización garantizada. */
export async function requireAnalyst() {
  const session = await requireSession("analista");
  return { session, orgId: session.orgId as string };
}
