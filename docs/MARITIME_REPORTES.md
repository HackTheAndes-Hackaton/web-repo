# Reportes gestionados por la web con Maritime

La app móvil conserva su flujo actual. El servicio de voz entrega a la web los datos del cierre de una llamada ficticia; no decide ni publica informes. La web controla la autorización, llama al agente privado de Maritime, valida su respuesta contra el contexto recibido, guarda hallazgos y muestra el resumen en el dashboard. La revisión del analista y la futura exportación PDF también corresponden a la web.

## Configuración

En `web-repo/.env.local` o en las variables privadas del despliegue web:

```dotenv
MARITIME_REPORT_AGENT_ID=
MARITIME_REPORT_API_KEY=
TISKZ_REPORT_MODEL=gpt-4.1-mini
# Exclusivamente pruebas ficticias del equipo; false por defecto.
TISKZ_DEMO_REPORTS_ENABLED=true
```

El ID debe corresponder al agente de informes privado. La clave debe poder invocarlo. El modelo se configura dentro de Maritime; `TISKZ_REPORT_MODEL` identifica el modelo previsto mientras la solicitud está en curso y la respuesta guarda el identificador informado por el agente. No usar `NEXT_PUBLIC_` ni distribuir credenciales a la APK. La configuración de demo permite crear automáticamente un caso solo con `simulated=true`; no habilita casos reales ni anula revocaciones o permisos expresamente retirados.

## Recepción y generación

`POST /api/v1/case-finalizations` requiere API key y `X-Tiskz-Org`. Acepta `request_id` UUID, `session_id`, `simulated:true`, inicio/final ISO, `channel` (`webrtc` o `telefono_vapi`), `text` de hasta 12000 caracteres y `decision` opcional con `alerta`/`probabilidad`. El texto se usa de forma transitoria: no se almacena como conversación, historial ni cita.

La web reutiliza el ID determinista de la sesión, comprueba organización, sesión, origen, tiempos y permisos, registra el hash de la petición y reclama la generación antes de llamar a Maritime. Reintentar la misma entrega no vuelve a consumir tokens; una entrega simultánea recibe `202` mientras la primera sigue en curso. Reutilizar el UUID con otro contexto se rechaza.

El agente Maritime extrae señales e identificadores y redacta un resumen. La web vuelve a comprobar que cada valor, banco, billetera y moneda aparezca literalmente en el segmento señalado. Recalcula hashes y posiciones de origen a partir del texto recibido, rechaza citas largas de la conversación y no infiere identidad, culpabilidad ni IP original. Guarda el resultado con el contrato `pe-v1` y refresca las relaciones existentes. La narrativa requiere revisión humana antes de cualquier envío oficial.

La web conserva proveedor, modelo informado, versión del contrato, limitaciones y tokens. Un error produce `failed`, nunca una conclusión de llamada segura. Un permiso revocado mientras se ejecuta el agente impide guardar los hallazgos. El dashboard muestra estado y resumen. La comparación semántica ampliada, versiones del informe y PDF solicitado por el analista pertenecen a pasos posteriores.

## Pruebas y límites

`npm run test:db` usa una base temporal y no toca Supabase remoto. `npm run test:maritime` verifica el contrato HTTP con un agente simulado y la validación independiente de la web. `npm run test:report -- --mock` genera un ejemplo aislado sin red ni persistencia. Sin `--mock`, la prueba llama al agente privado con un caso ficticio, consume tokens y no escribe en el panel.

Publicar la web antes de habilitar entregas del servicio de voz. No hay migraciones ni cambios móviles en este cambio. No existe una cola durable ni se conserva el texto para reanudar: una interrupción abrupta puede dejar `running`. La versión actual es una demo con claves de servicio y sesión de panel de demostración; no se han validado reportes reales, telefonía física ni envío a la PNP.
