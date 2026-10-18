import "server-only";
import { z } from "zod";
import { RESOURCES, type ResourceDef } from "./resources";

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
  paths["/mcp"] = {
    post: {
      tags:["MCP"], summary:"Herramientas de audio autorizado mediante MCP Streamable HTTP",
      description:"JSON-RPC MCP: tools/list y tools/call. Herramientas guardar_fragmento, listar_fragmentos y escuchar_fragmento. X-Tiskz-Org obligatorio; la clave de servicio es global y nunca debe distribuirse a la APK. WAV PCM16 mono 16 kHz, 1–15 segundos, máximo seis fragmentos por sesión. No genera embeddings ni identifica personas.",
      parameters:[{name:"X-Tiskz-Org",in:"header",required:true,schema:{type:"string"}}],
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
      title: "Tiskz API",
      version: "1.0.0",
      description:
        "API gateway del panel de Tiskz. La consumen el servidor de llamadas y el servicio de IA para registrar incidentes, señales, datos observados y muestras de voz.",
    },
    servers: [{ url: `${baseUrl}/api/v1` }],
    security: [{ bearerAuth: [] }, { apiKeyHeader: [] }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", description: "Authorization: Bearer tkz_..." },
        apiKeyHeader: { type: "apiKey", in: "header", name: "X-API-Key" },
      },
      schemas,
    },
    paths,
  };
}
