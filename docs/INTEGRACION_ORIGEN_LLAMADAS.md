# Metadatos de origen de llamadas: integración de la web

Implementación del 17 de octubre de 2026. No identifica personas ni obtiene automáticamente la IP original de una llamada telefónica.

## Alcance implementado

- Vinculación explícita de incidente, llamada Android, solicitud de conferencia y llamada Vapi.
- Consulta desde el servidor a `GET https://api.vapi.ai/call/{id}` con clave privada de la cuenta.
- Conservación de una proyección mínima: ID, estado, proveedor, transporte, referencia del proveedor, fechas y número observado por Vapi cuando se faciliten.
- Presentación en **Casos → Datos observados → Procedencia de la llamada**, con consulta manual por un analista de la organización del incidente.
- Registro de asociación y consultas correctas en `actions`. Los reintentos de vinculación no duplican el registro; una asociación diferente requiere revisión.
- Persistencia en `incidents.analysis_meta.network_origin`, sin nuevas tablas ni migraciones. Se preservan el número original de Android y `provider_call_id`, que puede corresponder a otro identificador de telefonía.
- El API genérico de análisis no admite escribir `network_origin`. Sus actualizaciones de `analysis_meta` conservan esta sección; cambiar el identificador Android vinculado produce un conflicto.

El adaptador no interpreta campos arbitrarios de IP, URLs, cabeceras SIP ni SDP. No conserva transcripciones, grabaciones, secretos o el objeto completo de Vapi. No habilita PCAP ni consulta GeoIP. La respuesta actual siempre distingue entre consulta pendiente e **IP original no disponible en los metadatos consultados**. No existe un campo documentado y validado para atribuir esa dirección al interlocutor en esta conferencia.

## Configuración local y despliegue

Añadir `VAPI_PRIVATE_KEY` al entorno **del servidor web**, usando una clave privada de la cuenta que contiene las llamadas. El nombre está en `.env.example`. No usar `NEXT_PUBLIC_` ni enviarla a la APK. Si falta, consultar devuelve `503 vapi_not_configured`, sin borrar la última consulta correcta. Reiniciar el servidor después de configurar el entorno.

Las llamadas al API requieren la clave de integración existente (`Authorization: Bearer …`) y `X-PhoneWard-Org`. Estas claves de servicio son globales en el sistema actual: el encabezado de organización restringe la operación, pero no transforma una clave global en una credencial por usuario. Deben permanecer en el backend autorizado.

El incidente debe estar compartido con esa organización, no tener revocada la compartición y contar con `consent_snapshot.network_metadata_storage=true`. Este permiso debe proceder de una autorización específica de conservación registrada por el sistema de origen; la web no lo activa por el permiso de análisis, el permiso de audio ni la aprobación del analista. Definir conservación y eliminación con el equipo antes de recolectar datos reales.

## Contrato para el backend de Vapi pendiente de subir a agents

No se modificó el backend desplegado: su código no está disponible en `agents`. Allí debe conectarse este contrato cuando esté disponible. No relacionar llamadas por hora, voz o número compartido.

1. Crear o actualizar el incidente existente con su `client_call_id` real de Android y el consentimiento específico. Conservar `caller_number_raw` / `caller_e164` del primer tramo sin reemplazarlos con `customer.number` de Vapi.
2. Cuando el backend conozca la asociación determinista entre solicitud de conferencia y `phone.call.call_id`, enviar:

   `PUT /api/v1/incidents/{incident_id}/network-origin`

   Encabezados: `Authorization: Bearer <clave de integración>`, `X-PhoneWard-Org: <organización>`, `Content-Type: application/json`.

   ```json
   {
     "client_call_id": "android-test",
     "conference_request_id": "30000000-0000-4000-8000-000000000001",
     "vapi_call_id": "40000000-0000-4000-8000-000000000001",
     "route": "android_sim_conference"
   }
   ```

   Todos los valores son ficticios. Usar los IDs reales de la misma conferencia, no regenerarlos al reintentar. Si el backend actual no conserva una asociación inequívoca, debe añadirse ese intercambio antes de enviar el `PUT`. El identificador Android debe coincidir exactamente con el incidente. Una llamada Vapi o solicitud de conferencia ya vinculada a otro incidente produce `409`, incluso ante solicitudes concurrentes por esta integración.

3. Consultar `POST /api/v1/incidents/{incident_id}/network-origin`, sin cuerpo, con los mismos encabezados. También puede hacerlo el analista mediante el botón del reporte. El servidor consulta Vapi; la APK no utiliza su clave privada.
4. Leer `GET /api/v1/incidents/{incident_id}/network-origin`. Devuelve `{ "data": null }` si está autorizado pero aún no se vinculó; después devuelve asociación y última consulta correcta.

El número de `inspection.call.customer.number` se presenta como **número observado por Vapi**, pendiente de verificar qué participante representa. No se incorpora como número del sospechoso ni se utiliza para crear vínculos entre incidentes.

## Errores y permisos

- `401`: falta una clave de integración válida.
- `403 network_storage_not_authorized`: no hay autorización de conservación o se revocó la compartición. Se revalida después de consultar al proveedor y antes de guardar.
- `404`: el incidente no pertenece a la organización solicitada o no existe.
- `409`: asociación incompatible, duplicada en otro incidente o identificador Android ausente/diferente.
- `502`: respuesta inesperada, llamada no disponible en esa cuenta, rechazo del proveedor, exceso de tamaño o espera. La consulta usa destino fijo, sin redirecciones, límite de 1 MiB y espera de ocho segundos; no registra el cuerpo de error.
- `503 vapi_not_configured`: falta configurar la clave privada en la web.

El resultado correcto con `availability: "unavailable"` no es un error de API: expresa que los metadatos disponibles no permiten atribuir una IP original. La autorización revocada bloquea esta integración y oculta sus datos en el panel; este módulo no incluye un proceso automático de borrado histórico de la base. La administración directa de la base y el API de servicio global existente siguen requiriendo controles de acceso del despliegue.

## Comprobación pendiente con el equipo

Subir el backend actualizado y conectar los identificadores; configurar la clave privada localmente; realizar una conferencia con participantes del equipo y contrastar ambos tramos con el registro de Vapi. Confirmar con el proveedor si alguna integración futura entrega una dirección del extremo original. Hasta entonces no añadir un supuesto campo `callerIp` ni habilitar PCAP como mecanismo de identificación.

Las pruebas automatizadas utilizan una base local temporal y respuestas sintéticas. Comprueban permisos, correlación, reintentos, rechazo de duplicados, conservación de metadatos existentes y exclusión de campos de contenido/IP sin procedencia. No llaman a Vapi ni acreditan una conferencia física.

Fuentes: [Vapi Get Call](https://docs.vapi.ai/api-reference/calls/get), [eventos](https://docs.vapi.ai/server-url/events), [red SIP](https://docs.vapi.ai/advanced/sip/sip-networking). Contexto de diseño: [PROPUESTA_IP_VAPI.md](./PROPUESTA_IP_VAPI.md).
