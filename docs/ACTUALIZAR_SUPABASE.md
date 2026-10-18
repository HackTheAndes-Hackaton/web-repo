# Actualizar la base existente

La migración `20261017010000_call_data_and_review_history.sql` añade los datos del móvil y de las muestras de voz y conserva las revisiones. No borra conversaciones ni recrea la base. Quedan 12 tablas funcionales: las 11 anteriores y `voice_profiles`. El historial técnico de migraciones está separado en `app_meta.schema_migrations`.

## Conexión privada

Completa `.env.local` en la raíz del repositorio. Está ignorado por Git; no lo pegues en el chat ni lo copies a código del navegador.

- `DATABASE_URL`: URL completa de Postgres desde Supabase → Connect. Para el servidor web puede usarse Transaction pooler.
- `MIGRATION_DATABASE_URL`: conexión directa o Session pooler para el comando de migración. Es opcional; si está vacío se usa `DATABASE_URL`.
- `DATABASE_POOL_MAX`: conexiones del servidor web, por defecto 5.

Si introduces la contraseña a mano, codifica los caracteres especiales como parte de una URL. La contraseña es la de la base, no la anon key ni la service_role key. Este código no necesita esas claves de API de Supabase.

Referencia de conexiones: [documentación de Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres).

## Aplicar y comprobar

Desde la carpeta `web-repo`, con las dependencias instaladas:

```powershell
npm run db:check
npm run db:migrate
npm run db:check
```

`db:check` usa una transacción de solo lectura y muestra estructura y migraciones pendientes, sin datos de usuarios ni credenciales. `db:migrate` aplica los cambios pendientes en una transacción, con bloqueo para impedir ejecuciones simultáneas. El segundo chequeo debe mostrar `pending_migrations: []`.

Si falla una sentencia, se revierte la transacción. Una base antigua sin historial se registra como base inicial y recibe la migración incremental; también se admite la columna antigua `shared_org_id`. No uses «Restablecer datos de demo» para actualizar Supabase.

Tras aplicar la migración, despliega el código actualizado de la web. El arranque también comprueba las migraciones pendientes para evitar que una tabla `links` existente oculte versiones antiguas. En Vercel configura `DATABASE_URL` en las variables del proyecto; el archivo local no se sube.

## Datos nuevos de la llamada

`POST /api/v1/incidents` y `PATCH /api/v1/incidents/{id}` admiten:

- Correlación: `external_id`, `client_call_id`, `provider_call_id`, `agent_session_id`.
- Origen: `caller_number_raw`, `caller_e164`, `caller_name` opcional, `direction` (`incoming`/`outgoing`), `simulated`.
- Telefonía: `call_status` (`ringing`/`active`/`ended`/`rejected`/`missed`), `answered_at`, `talk_duration_s`, `blocked`.
- Agente: `agent_status`, `ready_to_answer`.
- Análisis: `analysis_status` (`pending`/`running`/`completed`/`failed`), `verdict` (`none`/`safe`/`suspicious`/`scam`), `risk_reasons`, `scam_type`, `impersonating`, `analysis_meta`.
- Decisión independiente del usuario: `user_feedback` (`safe`/`scam`/`unsure`) y `user_feedback_at`.
- Permisos vigentes: `consent_snapshot`; fechas `shared_at` y `sharing_revoked_at`.

Los valores de `verdict` son el resultado del análisis. El backend debe conservar la corrección de Android en `user_feedback`, sin sustituir silenciosamente la evaluación original. Un número o un nombre recibido no acredita identidad. Un riesgo inicial 0 con `analysis_status=pending` significa «sin evaluar».

`users.settings` guarda preferencias sin una tabla adicional. `actions` puede recibir `actor_id`, `actor_kind` (`user`/`analyst`/`service`/`system`), `result` (`requested`/`applied`/`failed`), `request_id`, `link_id` y `payload` JSON. Una solicitud de colgar o bloquear no se registra como aplicada hasta recibir su resultado.

> **Nota posterior:** la transcripción se retiró del panel y de la API (`/segments` ya no existe, y las señales y datos ya no aceptan `segment_id` ni `evidence`). La tabla `segments` sigue en la base sin usarse; los vínculos ya no comparan guiones, solo tipos de señal.

La transcripción añade `external_segment_id`, `flagged`, `is_final`, `end_offset`, `source` y `updated_at`. Para una corrección parcial/final de la misma frase utiliza el mismo registro y `PATCH`; `external_segment_id` es único dentro de la conversación. Los segmentos del agente, usuario y llamante llevan `speaker=agent/user/caller`; el contenido para comparar guiones usa solamente frases finales del llamante.

Las señales y entidades incorporan `analysis_meta` para modelo y versión.

## Muestras y perfiles vocales

Ejemplo de metadatos para una muestra del llamante:

```json
{
  "model_id": "speechbrain/spkrec-ecapa-voxceleb",
  "model_version": "REVISION_EXACTA_DEL_MODELO",
  "speaker": "caller",
  "quality_status": "usable",
  "review_status": "pendiente",
  "reference_enabled": false,
  "duration_s": 15,
  "source_session_ref": "agent-session-123"
}
```

Envía además `embedding` al crear la muestra. La API calcula `embedding_dims` y no devuelve el vector. No uses la dimensión para identificar un modelo: el mismo modelo y versión deben coincidir también.

Una comparación necesita muestras utilizables del llamante y permiso `consent_snapshot.voice_storage=true`. Al menos uno de los dos lados debe ser una referencia con `review_status=aprobada`, `reference_enabled=true` y `consent_snapshot.voice_reference=true`. Una muestra nueva no se convierte automáticamente en referencia. Se excluyen referencias de perfiles descartados y se mantienen separados los datos simulados y reales.

`POST /api/v1/voice-profiles` crea una agrupación, por ejemplo `{"org_id":"org_uav","public_code":"VOZ-001","simulated":false}`. Su estado es provisional/revisado/descartado. `PATCH /api/v1/voice-samples/{id}` puede asignar `profile_id`; la base comprueba que perfil y conversación tengan la misma organización y origen. El código identifica una agrupación revisable, no una persona identificada.

Las muestras históricas conservan sus vectores, pero quedan pendientes y con referencias desactivadas. Debe completarse su modelo, versión, hablante, calidad y permisos antes de habilitarlas. `simulated` queda `null` para conversaciones anteriores: indica origen desconocido, y no se recomparan automáticamente hasta clasificarlas como demo (`true`) o reales (`false`). No se inventan autorizaciones ni resultados de análisis anteriores.

## Evidencia revisada

- Los vínculos pendientes pueden actualizar su puntuación y razones; cambia `evidence_version` si cambia la evidencia.
- Confirmar o descartar guarda `reviewed_evidence` y `reviewed_evidence_version`, además del identificador del revisor.
- Las recalculaciones automáticas conservan intactos los vínculos revisados. La base rechaza un intento de cambiar su evidencia mientras sigan confirmados o descartados.
- Para evaluar evidencia nueva, pulsa «Volver a pendiente para recalcular». La decisión anterior queda en `actions.payload.before`; la nueva queda en `after`.
- La API no permite editar o borrar eventos `link_review`. `reviewed_by` se conserva como nombre legible y `reviewed_by_id` referencia al usuario.

Se mantiene el acceso de demostración, las claves globales y la función de reinicio existente. La autenticación y el alcance de claves quedan para la etapa posterior acordada.
