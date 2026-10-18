import "server-only";
import { z } from "zod";
import { RESOURCES, type ResourceDef } from "./resources";
import { audioInput } from "./audio";
import { callInput, SPEAKERS } from "./calls";
import { findingsInput } from "./findings";
import { caseFinalizationInput } from "./case-finalizations";
import { networkBindingInput, networkOriginSchema } from "../network-origin";

/** Especificación OpenAPI 3.1 generada a partir de las definiciones de recursos. */

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: unknown) => ({ "application/json": { schema } });

const errorResponses = {
  "401": { description: "Falta una API key válida.", content: json(ref("Error")) },
  "404": { description: "No encontrado.", content: json(ref("Error")) },
  "422": { description: "Datos inválidos.", content: json(ref("Error")) },
};

function schemaName(def: ResourceDef) {
  return def.name.replace(/(^|-)(\w)/g, (_, __, c: string) => c.toUpperCase());
}

function inputSchema(schema: z.ZodType) {
  const s = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  delete s.$schema;
  return s;
}

function queryParams(def: ResourceDef, nested: boolean) {
  const filters = def.filters
    .filter((f) => !(nested && f === "incident_id"))
    .map((f) => ({ name: f, in: "query", required: false, schema: { type: "string" }, description: `Filtra por ${f} (usa "null" para vacíos).` }));
  const extra =
    def.name === "links"
      ? [{ name: "incident_id", in: "query", schema: { type: "string" }, description: "Vínculos donde participa el incidente." }]
      : [];
  return [
    ...filters,
    ...extra,
    { name: "since", in: "query", schema: { type: "string", format: "date-time" }, description: `${def.dateColumn} >= since` },
    { name: "until", in: "query", schema: { type: "string", format: "date-time" }, description: `${def.dateColumn} < until` },
    { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 200, default: 50 } },
    { name: "offset", in: "query", schema: { type: "integer", minimum: 0, default: 0 } },
  ];
}

export function buildOpenApi(baseUrl: string) {
  const schemas: Record<string, unknown> = {
    Error: {
      type: "object",
      properties: {
        error: {
          type: "object",
          properties: { code: { type: "string" }, message: { type: "string" }, details: {} },
          required: ["code", "message"],
        },
      },
    },
    Pagination: {
      type: "object",
      properties: { limit: { type: "integer" }, offset: { type: "integer" }, total: { type: "integer" } },
    },
  };
  const paths: Record<string, unknown> = {};
  schemas.CaseFinalization = inputSchema(caseFinalizationInput);
  paths["/case-finalizations"] = {post:{tags:["Hallazgos"],summary:"Entregar el cierre de un caso ficticio para analizarlo en la web",
    description:"Solo servidor. La web comprueba sus permisos y solicita la inferencia al agente Maritime. El contexto es transitorio; solo persiste hallazgos, resumen y hashes. request_id evita repetir la generación. Solo simulated=true en esta versión.",
    parameters:[{name:"X-PhoneWard-Org",in:"header",required:true,schema:{type:"string"}}],
    requestBody:{required:true,content:json(ref("CaseFinalization"))},responses:{"200":{description:"Generación completada o resultado de la entrega anterior."},
      "202":{description:"La misma entrega sigue en curso; no se vuelve a invocar el modelo."},...errorResponses,
      "403":{description:"Permiso del reporte retirado o compartición revocada."},"409":{description:"Caso, request_id o generación incompatibles."},
      "502":{description:"La generación falló; el caso no se considera seguro."},"503":{description:"Maritime no configurado en el servidor web."}}}};
  schemas.FinalizedFindings = inputSchema(findingsInput);
  paths["/incidents/{id}/findings"] = {
    post: {
      tags: ["Hallazgos"], summary: "Entregar hallazgos completos al finalizar una llamada",
      description: "Contrato pe-v1, solo servidor. Guarda señales, entidades, conclusión y constancia en una transacción. run_id idempotente y revisión creciente. No llama al modelo ni guarda transcripciones. La sesión debe coincidir con agent_session_id del incidente.",
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } },
        { name: "X-PhoneWard-Org", in: "header", required: true, schema: { type: "string" } }],
      requestBody: { required: true, content: json(ref("FinalizedFindings")) },
      responses: { "200": { description: "Entrega guardada o reintento idéntico reconocido." }, ...errorResponses,
        "403": { description: "Compartición revocada." }, "409": { description: "Sesión, origen, revisión o run_id incompatibles." } },
    },
  };
  schemas.NetworkOrigin = inputSchema(networkOriginSchema);
  schemas.NetworkBinding = inputSchema(networkBindingInput);
  const networkParameters = [
    { name: "id", in: "path", required: true, schema: { type: "string" } },
    { name: "X-PhoneWard-Org", in: "header", required: true, schema: { type: "string" } },
  ];
  const networkResponse = { "200": { description: "Procedencia de la llamada; null si aún no se vinculó. La conferencia no aporta una IP original verificable.", content: json({ type: "object", properties: { data: { anyOf: [ref("NetworkOrigin"), { type: "null" }] } } }) }, ...errorResponses,
    "403": { description: "Conservación no autorizada o compartición revocada." }, "409": { description: "Identificadores incompatibles o llamada vinculada a otro incidente." },
  };
  paths["/incidents/{id}/network-origin"] = {
    get: { tags: ["Procedencia"], summary: "Leer metadatos de origen autorizados", parameters: networkParameters, responses: networkResponse },
    put: { tags: ["Procedencia"], summary: "Vincular conferencia Android con Vapi", description: "Solo servidor. client_call_id debe coincidir con el incidente. Requiere consent_snapshot.network_metadata_storage=true. Reintentos idénticos no duplican el registro.", parameters: networkParameters,
      requestBody: { required: true, content: json(ref("NetworkBinding")) }, responses: networkResponse },
    post: { tags: ["Procedencia"], summary: "Consultar metadatos de la llamada vinculada en Vapi", description: "Usa VAPI_PRIVATE_KEY en el servidor. No consulta GeoIP ni interpreta IPs de proxies como direcciones del interlocutor.", parameters: networkParameters,
      responses: { ...networkResponse, "502": { description: "Error o respuesta inválida del proveedor; conserva la última consulta correcta." }, "503": { description: "Falta configurar VAPI_PRIVATE_KEY." } } },
  };

  schemas.CallInput = inputSchema(callInput);
  schemas.TranscriptLine = {
    type: "object",
    properties: {
      id: { type: "string" }, idx: { type: "integer" }, speaker: { type: ["string", "null"], enum: [...SPEAKERS, null] },
      text: { type: "string" }, flagged: { type: "boolean" }, t_offset: { type: "number" }, external_segment_id: { type: ["string", "null"] },
    },
  };
  const callOrg = { name: "X-PhoneWard-Org", in: "header", required: true, schema: { type: "string" }, description: "Organización con la que la persona comparte sus llamadas." };
  const callIdParam = { name: "callId", in: "path", required: true, schema: { type: "string" }, description: "client_call_id generado por Android." };
  const callErrors = { ...errorResponses, "400": { description: "Falta X-PhoneWard-Org o el identificador no es válido.", content: json(ref("Error")) } };
  paths["/calls"] = {
    get: {
      tags: ["Llamadas"], summary: "Listar llamadas recientes con su conversación guardada",
      description: "Llamadas registradas por la app (con client_call_id), de la más reciente a la más antigua, con cuántas líneas de conversación tienen.",
      parameters: [callOrg, { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 200, default: 50 } }, { name: "offset", in: "query", schema: { type: "integer", minimum: 0, default: 0 } }],
      responses: { "200": { description: "Lista paginada.", content: json({ type: "object", properties: { data: { type: "array", items: { type: "object" } }, pagination: ref("Pagination") } }) }, ...callErrors },
    },
  };
  paths["/calls/{callId}"] = {
    put: {
      tags: ["Llamadas"], summary: "Guardar una llamada y su conversación",
      description: "La app la envía al terminar la llamada: datos de la llamada y la conversación completa (asistente, quien llama y titular). Reenviar el mismo callId actualiza la llamada y reemplaza la conversación; no duplica. Respuesta 201 al crear, 200 al actualizar.",
      parameters: [callOrg, callIdParam],
      requestBody: { required: true, content: json(ref("CallInput")) },
      responses: { "200": { description: "Actualizada." }, "201": { description: "Creada." }, "403": { description: "La persona revocó la compartición." }, ...callErrors },
    },
    get: {
      tags: ["Llamadas"], summary: "Obtener una llamada con su conversación",
      parameters: [callOrg, callIdParam],
      responses: { "200": { description: "Incidente y conversación ordenada.", content: json({ type: "object", properties: { data: { type: "object", properties: { incident: ref("Incidents"), transcript: { type: "array", items: ref("TranscriptLine") } } } } }) }, ...callErrors },
    },
  };
  paths["/reputation/{number}"] = {
    get: {
      tags: ["Llamadas"], summary: "Reputación comunitaria de un número",
      description: "Cuántas llamadas reales marcaron el número como estafa o sospechoso (en cualquier organización) y en cuántos casos se mencionó, por ejemplo como número de Yape. Solo totales: no expone conversaciones, personas ni organizaciones. La app lo consulta mientras suena la llamada.",
      parameters: [{ name: "number", in: "path", required: true, schema: { type: "string" }, description: "Número en cualquier formato; se compara por sus últimos dígitos." }],
      responses: { "200": { description: "Totales del número.", content: json({ type: "object", properties: { data: { type: "object", properties: {
        number_key: { type: "string" }, reports: { type: "integer" }, scam: { type: "integer" }, suspicious: { type: "integer" }, mentioned_in: { type: "integer" },
        last_reported_at: { type: ["string", "null"], format: "date-time" }, scam_type: { type: ["string", "null"] }, impersonating: { type: ["string", "null"] },
      } } } }) }, ...callErrors },
    },
  };
  paths["/incidents/{id}/transcript"] = {
    get: {
      tags: ["Llamadas"], summary: "Conversación de un incidente",
      parameters: [callOrg, { name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: { "200": { description: "Líneas en orden.", content: json({ type: "object", properties: { data: { type: "array", items: ref("TranscriptLine") } } }) }, ...callErrors },
    },
  };

  const audioOrg = {name:"X-PhoneWard-Org",in:"header",required:true,schema:{type:"string"}};
  const audioSession = {name:"session_id",in:"query",required:true,schema:{type:"string",format:"uuid"}};
  paths["/audio-fragments"] = {
    post:{tags:["Audio"],summary:"Guardar WAV autorizado (misma operación que MCP)",parameters:[audioOrg],
      requestBody:{required:true,content:json(inputSchema(audioInput))},responses:{"201":{description:"Metadatos; request_id idempotente por sesión."},...errorResponses}},
    get:{tags:["Audio"],summary:"Listar fragmentos autorizados de una sesión",parameters:[audioOrg,audioSession],responses:{"200":{description:"Hasta seis fragmentos; sin audio."},...errorResponses}},
  };
  paths["/audio-fragments/{id}"] = {
    get:{tags:["Audio"],summary:"Recuperar WAV autorizado",parameters:[audioOrg,audioSession,{name:"id",in:"path",required:true,schema:{type:"string"}}],
      responses:{"200":{description:"WAV PCM16 mono 16 kHz",content:{"audio/wav":{schema:{type:"string",format:"binary"}}}},...errorResponses}},
  };
  paths["/mcp"] = {
    post: {
      tags:["MCP"], summary:"Herramientas de audio autorizado mediante MCP Streamable HTTP",
      description:"JSON-RPC MCP: tools/list y tools/call. Herramientas guardar_fragmento, listar_fragmentos y escuchar_fragmento. X-PhoneWard-Org obligatorio; la clave de servicio es global y nunca debe distribuirse a la APK. WAV PCM16 mono 16 kHz, 1–15 segundos, máximo seis fragmentos por sesión. No genera embeddings ni identifica personas.",
      parameters:[{name:"X-PhoneWard-Org",in:"header",required:true,schema:{type:"string"}}],
      requestBody:{required:true,content:json({type:"object",required:["jsonrpc","method"],properties:{jsonrpc:{const:"2.0"},id:{},method:{type:"string"},params:{type:"object"}}})},
      responses:{"200":{description:"Resultado JSON-RPC MCP; audio recuperado como contenido audio/wav en base64."},...errorResponses},
    },
  };

  for (const def of RESOURCES) {
    const name = schemaName(def);
    schemas[name] = {
      type: "object",
      description: def.description,
      properties: Object.fromEntries(def.columns.map((c) => [c, {}])),
    };
    schemas[`${name}Create`] = inputSchema(def.create);
    schemas[`${name}Update`] = inputSchema(def.update);

    const createBody = {
      required: true,
      description: "Un objeto o un arreglo (hasta 500) para crear en lote.",
      content: json({ oneOf: [ref(`${name}Create`), { type: "array", items: ref(`${name}Create`), maxItems: 500 }] }),
    };
    const listResponse = {
      description: "Lista paginada.",
      content: json({ type: "object", properties: { data: { type: "array", items: ref(name) }, pagination: ref("Pagination") } }),
    };
    const itemResponse = (description: string) => ({
      description,
      content: json({ type: "object", properties: { data: ref(name) } }),
    });

    paths[`/${def.name}`] = {
      get: { tags: [def.title], summary: `Listar ${def.title.toLowerCase()}`, parameters: queryParams(def, false), responses: { "200": listResponse, ...errorResponses } },
      post: { tags: [def.title], summary: `Crear ${def.title.toLowerCase()}`, description: def.description, requestBody: createBody, responses: { "201": itemResponse("Creado (o arreglo de creados)."), ...errorResponses } },
    };
    const idParam = { name: "id", in: "path", required: true, schema: { type: "string" } };
    paths[`/${def.name}/{id}`] = {
      get: {
        tags: [def.title],
        summary: `Obtener ${def.title.toLowerCase()}`,
        parameters: [
          idParam,
          ...(def.name === "incidents"
            ? [{ name: "include", in: "query", schema: { type: "string" }, description: "Lista separada por comas: signals, entities, actions, notes, voice-samples, links." }]
            : []),
        ],
        responses: { "200": itemResponse("Registro."), ...errorResponses },
      },
      patch: {
        tags: [def.title],
        summary: `Actualizar ${def.title.toLowerCase()}`,
        parameters: [idParam],
        requestBody: { required: true, content: json(ref(`${name}Update`)) },
        responses: { "200": itemResponse("Actualizado."), ...errorResponses },
      },
      delete: { tags: [def.title], summary: `Borrar ${def.title.toLowerCase()}`, parameters: [idParam], responses: { "200": { description: "Borrado." }, ...errorResponses } },
    };
    if (def.childOfIncident) {
      paths[`/incidents/{id}/${def.name}`] = {
        get: { tags: [def.title], summary: `${def.title} de un incidente`, parameters: [idParam, ...queryParams(def, true)], responses: { "200": listResponse, ...errorResponses } },
        post: {
          tags: [def.title],
          summary: `Agregar ${def.title.toLowerCase()} a un incidente`,
          description: `${def.description} incident_id se toma de la URL.`,
          parameters: [idParam],
          requestBody: createBody,
          responses: { "201": itemResponse("Creado (o arreglo de creados)."), ...errorResponses },
        },
      };
    }
  }

  paths["/links/recompute"] = {
    post: {
      tags: ["Vínculos"],
      summary: "Recalcular vínculos propuestos",
      requestBody: {
        required: true,
        content: json({ type: "object", properties: { incident_id: { type: "string" }, org_id: { type: "string" } } }),
      },
      responses: { "200": { description: "Cantidad de incidentes recalculados." }, ...errorResponses },
    },
  };

  return {
    openapi: "3.1.0",
    info: {
      title: "PhoneWard API",
      version: "1.0.0",
      description:
        "API gateway del panel de PhoneWard. La consumen el servidor de llamadas y el servicio de IA para registrar incidentes, señales, datos observados y muestras de voz.",
    },
    servers: [{ url: `${baseUrl}/api/v1` }],
    security: [{ bearerAuth: [] }, { apiKeyHeader: [] }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", description: "Authorization: Bearer phw_..." },
        apiKeyHeader: { type: "apiKey", in: "header", name: "X-API-Key" },
      },
      schemas,
    },
    paths,
  };
}
