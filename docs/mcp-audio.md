# Audio autorizado de Tiskz

`POST /api/v1/mcp` expone MCP Streamable HTTP con autenticación de la API existente (`Authorization: Bearer tkz_…`) y `X-Tiskz-Org`. Las claves actuales son globales de servicio; no son credenciales de usuarios ni se distribuyen a la APK. El backend fija la organización y la sesión antes de llamar herramientas.

Herramientas:

- `guardar_fragmento`: `session_id` y `request_id` UUID, `consentimiento_conservacion: true`, `audio_base64`, `source` (`webrtc_microphone` o `provider_mixed`), `risk_percent` entero 0–100 o null.
- `listar_fragmentos`: `session_id`; devuelve metadatos de hasta seis fragmentos.
- `escuchar_fragmento`: `session_id`, `fragment_id`; devuelve contenido MCP `audio`, MIME `audio/wav`, base64. La APK recibe WAV mediante su backend y su ticket de sesión, sin conocer la clave del panel.

La migración añade `audio_fragments`; se aplica con el mecanismo existente al iniciar la base. Guarda WAV original en Postgres (1–15 segundos, PCM16 mono 16 kHz, máximo seis por sesión), hash SHA-256 y procedencia. La APK envía como máximo 10 segundos. La reproducción exige la misma organización y sesión y que `consent_snapshot.voice_storage` siga siendo true. No se expone audio en listas. Revocar permiso impide lectura y nuevas cargas; eliminar el incidente elimina los fragmentos por cascada. La revocación por sí sola no borra los bytes. No hay borrado periódico automático.

La conservación y el uso como referencia son permisos distintos. Los fragmentos tienen `speaker=unknown`, revisión pendiente y `voice_reference=false`. No se copian a `voice_samples`, no producen embeddings ni se incorporan a comparaciones biométricas. Un clip mezclado nunca es referencia de una persona. Una alerta es provisional y el número de Vapi no acredita el número de quien originó una conferencia.

Implementación inicial: audio del micrófono en WebRTC. La APK de conferencia telefónica recibe transcripciones, no PCM de Entel. Para conservar esa voz falta una fuente de audio del proveedor compatible con el modelo utilizado; no se sustituye con el micrófono del propietario. SMS y corte de llamada no se ejecutan mediante estas herramientas.

Validación: `npm run test:db`, `npm run build`, `npm run lint`. Las pruebas usan una base efímera y audio sintético; no escriben datos de personas en producción.


## API HTTP para cargas automáticas

El guardado determinista de la APK puede usar HTTP en lugar de `tools/call`. Comparte `saveAudio`, `listAudio` y `loadAudio` con MCP; no duplica almacenamiento ni cambia permisos.

- `POST /api/v1/audio-fragments`: mismo cuerpo que `guardar_fragmento`; responde `{data: metadatos}`.
- `GET /api/v1/audio-fragments?session_id=UUID`: lista sin audio.
- `GET /api/v1/audio-fragments/{id}?session_id=UUID`: WAV con `Cache-Control: no-store`.

Exige la clave de servicio y `X-Tiskz-Org`. El backend de voz los adjunta; la APK solo posee su ticket de sesión. No se admite subir directamente con una clave global incluida en la aplicación. MCP permanece disponible para las herramientas de agentes.
