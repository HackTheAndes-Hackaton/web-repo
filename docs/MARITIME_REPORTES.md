# Reportes gestionados por la web con Maritime

La app móvil conserva su flujo actual. El servicio de voz entrega a la web los datos del cierre de una llamada ficticia; no decide ni publica informes. La web controla la autorización, llama al agente privado de Maritime, valida su respuesta contra el contexto recibido, guarda hallazgos y muestra el resumen en el dashboard. La revisión del analista y la exportación PDF también corresponden a la web.

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

La web conserva proveedor, modelo informado, versión del contrato, limitaciones y tokens. Un error produce `failed`, nunca una conclusión de llamada segura. Un permiso revocado mientras se ejecuta el agente impide guardar los hallazgos. El dashboard muestra estado y resumen.

## Explicación de vínculos propuestos

Al cerrar un caso, la web compara automáticamente como máximo los dos vínculos pendientes más fuertes que propuso el motor determinista. En `/panel/vinculos`, un analista puede solicitar o reintentar una comparación concreta. Ambos casos deben ser ficticios, conservar permiso de reporte y tener un resumen Maritime completo. La web envía solo los dos resúmenes y las categorías de razones ya calculadas; no envía conversaciones ni nuevos identificadores. El agente `tiskz-reportes` acepta `task: "explain_link"`; su versión publicada se comprobó el 18 de octubre de 2026.

Maritime clasifica el comportamiento como parecido, distinto o indeterminado y señala fragmentos literales de cada resumen y razones preexistentes. La web vuelve a validar esas referencias. La comparación se guarda en `links.evidence_snapshot.ai_explanation` con hash del contexto, versión, modelo y consumo; los reintentos idénticos no vuelven a invocar al modelo. El modelo no crea vínculos ni modifica puntuación o revisión. Cuando un analista confirma o descarta, la evidencia revisada se congela con la explicación disponible en ese momento. Si los datos deterministas cambian mientras el vínculo sigue pendiente, la explicación anterior deja de aplicarse y puede volver a generarse.

## Versiones de informe

En `/panel/informes`, un analista elige entre 2 y 20 casos ficticios y entre 1 y 50 vínculos que conecten todos los casos de un grupo elegible. Cada caso debe estar finalizado, tener un resumen Maritime completo y conservar los permisos de almacenamiento y compartición. Puede abrir una serie nueva o guardar otra versión de una serie existente. No hay una llamada adicional al modelo: el informe reúne los hallazgos ya producidos por Maritime y el estado de revisión existente.

La migración `20261018010000_report_versions.sql` crea `report_versions`. Cada fila guarda título, resumen, selección explícita, hallazgos, entidades, vínculos, evidencia, explicación disponible, autor, fecha y hash SHA-256 del contenido. La tabla impide actualizar o borrar versiones; los cambios posteriores solo aparecen en una versión nueva. El panel `/panel/informes` muestra la versión más reciente de cada serie y `/panel/informes/[id]` permite revisar el contenido y el historial. Cuando se retira el permiso o se revoca la compartición de cualquiera de sus casos, la web deja de mostrar la versión afectada.

## PDF solicitado por el analista

El dashboard enseña el resumen de la última versión guardada. La descarga `GET /panel/informes/[id]/pdf` exige sesión de analista y consulta la misma versión autorizada que la página de detalle. Se genera en ese momento, a partir de la copia guardada, sin volver a consultar los casos para cambiar el contenido y sin invocar Maritime. Lleva resumen, casos, señales, identificadores mencionados, razones y explicaciones de los vínculos, límites, autor, fecha y hash del contenido guardado. Cada página marca que se trata de casos ficticios y de un informe preliminar. No incluye audio ni conversación íntegra. Una revocación impide descargarlo de nuevo. El PDF descargado previamente queda bajo custodia del analista; la web no puede retirarlo.

La generación utiliza `pdf-lib` 1.17.1, distribuida en `src/lib/reports/vendor/` junto con su licencia. No precisa un servicio externo de PDF.

## Pruebas y límites

`npm run test:db` usa una base temporal y no toca Supabase remoto. `npm run test:maritime` verifica el contrato HTTP con un agente simulado y la validación independiente de la web. `npm run test:report -- --mock` genera un ejemplo aislado sin red ni persistencia. Sin `--mock`, la prueba llama al agente privado con un caso ficticio, consume tokens y no escribe en el panel.

`npm run test:flow` recorre con una base temporal dos cierres ficticios, un vínculo por cuenta repetida, una comparación simulada, la versión guardada, la generación del PDF y la revocación. Mide el tiempo local y reporta tokens simulados; no mide latencia ni costo reales de Maritime. Para comprobar el diseño puede configurarse `TISKZ_PDF_SAMPLE_PATH` a una ruta local de salida antes de ejecutar la prueba.

`npm run test:link` hace una comparación real de dos resúmenes ficticios sin persistirlos. Sirve para confirmar que el agente publicado acepta `explain_link` y observar su tiempo y uso de tokens.

El 18 de octubre de 2026 se redesplegó `tiskz-reportes` desde `agents` en `origin/main` con resultado `success`. Después del despliegue, una comparación real de dos resúmenes ficticios respondió en 5,1 s con 379 tokens, y una generación real de resumen respondió en 4,0 s con 795 tokens. Son muestras únicas, no garantías de latencia o gasto. No persistieron datos en el panel. `npm run db:check` contra Supabase indicó `pending_migrations: []`.

Antes de publicar la web en el entorno de demo: configurar sus dos variables privadas de Maritime en Vercel y activar `TISKZ_DEMO_REPORTS_ENABLED=true` solo para casos ficticios. Tras el despliegue, verificar en el sitio con dos sesiones ficticias, una coincidencia de cuenta, la revisión del vínculo y una descarga PDF. Registrar duración y consumo del flujo desde `report_generation.usage` y la explicación del vínculo. No enviar el PDF a la PNP en esta fase de pruebas.

Publicar la web antes de habilitar entregas del servicio de voz. Este paso agrega una migración para informes y no cambia la app móvil. No existe una cola durable ni se conserva el texto para reanudar: una interrupción abrupta puede dejar `running`. La versión actual es una demo con claves de servicio y sesión de panel de demostración; no se han validado reportes reales, telefonía física ni envío a la PNP.
