import { connection } from "next/server";
import { listCallsHandler } from "@/lib/api/calls-http";

/** Sin parámetros en la ruta, Next intentaría prerenderizarla: se marca dinámica antes de leer la solicitud. */
export async function GET(request: Request) {
  await connection();
  return listCallsHandler(request, {});
}
