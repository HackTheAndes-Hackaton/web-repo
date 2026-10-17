# Tiskz — panel y API

Este proyecto tiene dos partes:

- **Panel web (`/panel`)**: muestra la información para la organización analista. Incluye reportes, transcripciones,
  señales de riesgo, gráficas y vínculos entre casos.
- **API gateway (`/api/v1`)**: REST con una entrada por entidad. Por aquí envían sus datos el **servidor de llamadas**
  y el **servicio de IA**. Se autentica con API key.

La captura de audio y el análisis con IA viven en otros servicios; este proyecto solo recibe, guarda y muestra.

Next.js 16 (App Router) + Postgres (Supabase, con `pgvector`).

## Arranque rápido (sin Supabase)

```bash
npm install
npm run db:local      # Postgres local (PGlite) en el puerto 54322; déjalo corriendo
npm run dev           # en otra terminal
```

`.env.local` debe tener `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54322/postgres`. Los datos locales se
guardan en `.pglite/`.

Abre http://localhost:3000 y entra con **Analista demo**. La primera vez se crea el esquema y se cargan casos de demo
ficticios. Se vuelven a cargar con **Restablecer datos de demo**, que conserva las claves de API.

## Pasar a Supabase

1. Crea el proyecto y copia la cadena del **Session pooler** (botón **Connect** → Connection string). Usa esa y no la
   conexión directa (`db.<ref>.supabase.co`, solo IPv6) ni el Transaction pooler (puerto 6543, se cuelga con consultas
   en paralelo de `postgres.js`).
2. Ponla en `DATABASE_URL` dentro de `.env.local` (ver `.env.example`).
3. `npm run db:migrate`, o pega `supabase/migrations/*.sql` en el SQL Editor. Si no lo haces, la app aplica el
   esquema sola al arrancar.

Todas las tablas tienen RLS activado y sin políticas. La API pública de Supabase (`anon` / `authenticated`) no puede
leer nada, incluidos los embeddings de voz. Solo este servidor accede a Postgres.

## Desplegar en Vercel

1. Importa el repositorio en Vercel. No hace falta configurar nada del build: lo detecta como Next.js.
2. Necesitas una base accesible desde internet: el Postgres local no sirve en Vercel. Cualquiera de estas dos opciones
   funciona:
   - Agrega `DATABASE_URL` (la del Session pooler de Supabase) en **Settings → Environment Variables**.
   - Conecta la integración de Supabase desde el Marketplace de Vercel; la app usa su `POSTGRES_URL`.
3. Despliega. En la primera solicitud se crea el esquema y se cargan los datos de demo.

En Vercel el panel se actualiza cada 15 s en lugar de usar SSE, porque cada función es efímera.

## API

**Claves.** Se crean en el panel → **Integraciones**: una por servicio. La clave completa se muestra una sola vez y en
la base solo se guarda su hash. Se envía de cualquiera de estas dos formas:

```
Authorization: Bearer tkz_...
X-API-Key: tkz_...
```

**Especificación.** `GET /api/v1/openapi.json` (OpenAPI 3.1, importable en Postman o Swagger) y `GET /api/v1` son
públicas.

### Recursos

| Recurso | Colección | Bajo un incidente |
| --- | --- | --- |
| Organizaciones | `/organizations` | — |
| Personas | `/users` | — |
| Incidentes | `/incidents` | — |
| Transcripción | `/segments` | `/incidents/{id}/segments` |
| Señales de riesgo | `/signals` | `/incidents/{id}/signals` |
| Datos observados | `/entities` | `/incidents/{id}/entities` |
| Muestras de voz | `/voice-samples` | `/incidents/{id}/voice-samples` |
| Acciones | `/actions` | `/incidents/{id}/actions` |
| Notas | `/notes` | `/incidents/{id}/notes` |
| Vínculos | `/links` | `GET /links?incident_id={id}` |

Cada recurso tiene:

- `GET /{recurso}`: lista paginada. Acepta `?limit` (máx. 200), `?offset`, filtros por campo (`?org_id=`,
  `?status=`, `?risk_level=`, `?external_id=`…) y `?since` / `?until` en formato ISO 8601.
- `POST /{recurso}`: un objeto, o un arreglo de hasta 500 para crear en lote.
- `GET` / `PATCH` / `DELETE /{recurso}/{id}`.
- `GET /incidents/{id}?include=segments,signals,entities,actions,notes,voice-samples,links`: el incidente completo en
  una sola llamada.
- `POST /links/recompute` con `{ "incident_id" }` o `{ "org_id" }`: recalcula los vínculos.

### Formato de las respuestas

- Éxito: `{ "data": ... }`. En listas también llega `"pagination": { limit, offset, total }`.
- Error: `{ "error": { "code", "message", "details" } }`, con estos códigos:

| Código | Cuándo |
| --- | --- |
| 401 | Falta la clave o no es válida. |
| 404 | El registro o la ruta no existe. |
| 409 | `external_id` repetido. |
| 422 | Validación fallida, o una referencia a algo que no existe. |

### Flujo típico

```bash
# 1. El servidor de llamadas abre el incidente (external_id = su id de llamada)
POST /api/v1/incidents            {"external_id":"llamada-8841","org_id":"org_uav","channel":"llamada"}
# 2. Envía la transcripción conforme avanza (idx se asigna solo)
POST /api/v1/incidents/{id}/segments   [{"speaker":"interlocutor","t_offset":4,"text":"..."}]
# 3. La IA agrega señales, datos y voz
POST /api/v1/incidents/{id}/signals    [{"type":"dinero","evidence":"...","explanation":"...","confidence":0.9}]
POST /api/v1/incidents/{id}/entities   [{"kind":"telefono","value":"55 2841 7730","provenance":"mostrado"}]
POST /api/v1/incidents/{id}/voice-samples {"embedding":[...192 números...]}
# 4. Se cierra con el riesgo final (risk_level se deriva de risk_score si no se manda)
PATCH /api/v1/incidents/{id}      {"status":"finalizado","ended_at":"...","risk_score":82,"summary":"..."}
```

Detalles útiles:

- Cada escritura actualiza el panel en vivo y recalcula, después de responder, los vínculos del incidente: similitud
  de voz con pgvector, datos repetidos y parecido del guion.
- Un dato observado repetido en el mismo incidente no se duplica: la API devuelve el que ya existía con `200`.
- Un incidente solo aparece en el panel de la organización indicada en su `org_id`.

## Limitaciones conocidas

- **Acceso al panel de demo:** una cookie elige al analista. Para producción hay que usar Supabase Auth.
- **Actualizaciones en vivo con un solo proceso:** usan Server-Sent Events con un bus en memoria. Funcionan con
  `next dev` / `next start`; en un despliegue serverless hay que cambiarlas por Supabase Realtime.
- **Claves sin alcance por organización:** cualquier clave válida puede escribir en cualquier organización.
