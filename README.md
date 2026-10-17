# Centinela (nombre provisional)

Asistente contra estafas y extorsiones. La persona usuaria activa el micrófono del celular o la computadora durante una
conversación, la IA señala posibles señales de engaño en vivo y se genera un reporte revisable. Un panel permite a una
organización autorizada revisar los casos que le compartieron y explorar posibles vínculos entre ellos.

Next.js 16 (App Router) + Supabase (Postgres con `pgvector`).

## Configurar Supabase

1. Crea un proyecto en [supabase.com](https://supabase.com).
2. En **Project Settings → Database → Connection string**, copia la cadena del **Transaction pooler** (puerto 6543).
3. Copia `.env.example` a `.env.local` y pega la cadena en `DATABASE_URL`, con la contraseña de la base de datos.
4. Crea las tablas con cualquiera de estas opciones:
   - `npm run db:migrate`
   - pegar `supabase/migrations/20261017000000_init.sql` en el **SQL Editor** de Supabase
   - `supabase db push` con la CLI de Supabase

   Si no lo haces, la app aplica el esquema sola la primera vez que consulta la base.

Los datos de demo (ficticios) se cargan automáticamente cuando la tabla `users` está vacía. Se pueden volver a cargar
con **Restablecer datos de demo** en la página de inicio.

### Seguridad

- La app accede a Postgres **solo desde el servidor**. Todas las tablas tienen RLS activado y sin políticas, así que la
  API pública de Supabase (claves `anon` / `authenticated`) no puede leer nada, incluidos los embeddings de voz.
- Nunca expongas `DATABASE_URL` en el cliente ni la subas al repositorio (`.env*` está en `.gitignore`).
- La sesión actual es de demostración (una cookie elige el perfil). Para producción hay que reemplazarla por Supabase Auth.

## Desarrollo

```bash
npm install
npm run dev
```

Abre http://localhost:3000 y elige un perfil: **usuario** (captura y reportes) o **analista** (panel).

Variables opcionales en `.env.local`:

| Variable | Uso |
| --- | --- |
| `ANTHROPIC_API_KEY` | Analiza cada fragmento con Claude. Sin ella se usan reglas locales. |
| `CLAUDE_MODEL` | Modelo de Claude (por defecto `claude-opus-5-5`). |
| `ANALYSIS_MODE` | `reglas` o `claude` para forzar el motor de análisis. |
| `DATABASE_POOL_MAX` | Conexiones simultáneas a Postgres (por defecto 5). |

## Captura en el celular

La transcripción usa la Web Speech API del navegador (Chrome o Edge en Android y escritorio). Se pide permiso de
micrófono al iniciar la captura. También se pueden escribir frases o reproducir los guiones de demo.

## Limitaciones conocidas

- Las actualizaciones en vivo usan Server-Sent Events con un bus en memoria: funcionan con un solo proceso
  (`next dev` / `next start`). En un despliegue serverless (por ejemplo Vercel) hay que cambiarlo por Supabase Realtime.
- La similitud de voz solo existe si un servicio externo envía embeddings a `POST /api/incidents/:id/voice`.
