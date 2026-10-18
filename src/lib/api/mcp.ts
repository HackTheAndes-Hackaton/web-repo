import "server-only";
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { z } from "zod";
import { audioInput, saveAudio, listAudio, loadAudio } from "./audio";
import { ApiError } from "./http";

export function audioMcp(org: string, operations = { saveAudio, listAudio, loadAudio }) {
  return createMcpHandler(() => {
    const server = new McpServer({ name:"phoneward-evidence", version:"1.0.0" });
    const wrap = (fn: () => Promise<unknown>) => fn().then((data) => ({content:[{type:"text" as const,text:JSON.stringify(data)}]})).catch((err) => ({
      isError:true, content:[{type:"text" as const,text:err instanceof ApiError ? `${err.code}: ${err.message}` : "No se pudo procesar la evidencia."}],
    }));
    server.registerTool("guardar_fragmento", {
      description:"Conserva un fragmento autorizado, crea un incidente provisional y devuelve su ID. No identifica personas ni habilita reconocimiento biométrico.",
      inputSchema:audioInput,
      annotations:{destructiveHint:false,idempotentHint:true,openWorldHint:false},
    }, (input) => wrap(() => operations.saveAudio(org,input)));
    server.registerTool("listar_fragmentos", {
      description:"Lista hasta seis fragmentos autorizados de esta organización y sesión; no incluye audio.",
      inputSchema:z.object({session_id:z.uuid()}).strict(), annotations:{readOnlyHint:true,openWorldHint:false},
    }, ({session_id}) => wrap(() => operations.listAudio(org,session_id)));
    server.registerTool("escuchar_fragmento", {
      description:"Recupera WAV de un fragmento autorizado para reproducirlo. No realiza reconocimiento de voz ni confirma identidad.",
      inputSchema:z.object({session_id:z.uuid(),fragment_id:z.string().regex(/^clip_[a-f0-9]{48}$/)}).strict(), annotations:{readOnlyHint:true,openWorldHint:false},
    }, async ({session_id,fragment_id}) => {
      try { const data=await operations.loadAudio(org,session_id,fragment_id); return {content:[{type:"audio" as const,data:data.toString("base64"),mimeType:"audio/wav"}]}; }
      catch { return {isError:true,content:[{type:"text" as const,text:"Fragmento no disponible o sin autorización."}]}; }
    });
    return server;
  }, {maxRequestBodySize:700000});
}
