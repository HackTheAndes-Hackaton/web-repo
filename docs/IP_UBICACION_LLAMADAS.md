# IP y ubicación a partir de llamadas: opciones para Tiskz

Fecha de revisión: 17 de octubre de 2026. Estado: investigación y próximos pasos; no se implementan funciones de rastreo.

## Conclusión para el proyecto actual

El contrato móvil describe llamadas del operador desviadas al servidor. En ese flujo, **recibir o analizar la llamada no entrega automáticamente la IP ni las coordenadas del teléfono que la originó**. Android expone detalles como número o identificador de llamada; su API pública de llamadas no ofrece un método para consultar la IP o GPS del otro teléfono. [Android: Call.Details](https://developer.android.com/reference/android/telecom/Call.Details).

Hay dos conexiones distintas que conviene separar. Por la arquitectura documentada, la IP de la conexión móvil → backend correspondería al usuario protegido. La IP de un webhook del proveedor normalmente corresponde al proveedor. Ninguna de ellas debe etiquetarse como IP del interlocutor. Esto es una conclusión técnica sobre el flujo del proyecto, no una comprobación de sus registros de producción. [Twilio: direcciones de sus webhooks](https://help.twilio.com/articles/115015934048-All-About-Twilio-IP-Addresses).

## Comparación de opciones

| Opción | IP que puede obtenerse | Ubicación que puede obtenerse | Esfuerzo y condición |
| --- | --- | --- | --- |
| Llamada celular convencional o desviada | No se entrega la IP del llamante a una app común | No se entrega su GPS | Guardar metadatos disponibles es sencillo; localizar requiere colaboración autorizada del operador |
| SIP/VoIP en infraestructura propia o proveedor contratado | IP de origen de la conexión SIP observada; puede ser un intermediario | Estimación GeoIP si la dirección es útil y corresponde al extremo relevante | Medio si ya usan SIP; no se obtiene la IP del móvil original solo por convertir telefonía convencional a SIP |
| Llamada dentro de una plataforma WebRTC propia | Algunas estadísticas de conexión pueden incluir direcciones de candidatos | Como máximo una estimación por IP; el candidato puede ser un relay | Medio; exige controlar la plataforma y que el llamante participe en ella |
| Compartir ubicación voluntariamente | IP de la conexión a su servicio, si se registra de forma informada | Coordenadas del dispositivo con permiso, con su precisión y fecha | Bajo a medio; requiere colaboración de quien comparte; no es una solución pasiva para un estafador |
| Investigación mediante operador y autoridad competente | Registros de red que existan y proceda entregar | Datos de localización que pueda aportar el operador | La aplicación puede preparar el expediente; el acceso y sus tiempos dependen del procedimiento aplicable |

## 1. Metadatos de un proveedor SIP/VoIP

Un ejemplo documentado es Twilio SIP: el parámetro `SipSourceIp` indica desde qué IP llegó el `INVITE`, y `SipCallId` identifica esa sesión. Esta posibilidad es específica del flujo SIP. No significa que toda llamada telefónica entrante incluya la IP del celular original. Si hay una central, un SBC, un proxy o un operador intermedio, la dirección observada puede pertenecer a ese intermediario. [Twilio: SIP y TwiML](https://www.twilio.com/docs/voice/api/sip-twiml).

Próximos pasos:

1. Confirmar con el equipo qué proveedor recibe el desvío y si la entrada es telefonía convencional, SIP o un cliente de voz propio.
2. Revisar la documentación de los metadatos disponibles en la cuenta contratada; pedir al proveedor qué representa exactamente cada dirección.
3. Hacer una llamada de prueba autorizada entre dispositivos del equipo y comparar el registro del proveedor con la conexión esperada.
4. Si hay una IP pertinente, asociarla al identificador de sesión, fecha y hora con zona horaria, origen del dato y puerto/protocolo cuando estén disponibles. Una IP compartida necesita contexto temporal para ser investigable.
5. Etiquetar el dato como dirección observada del extremo o intermediario correspondiente, conservando el registro original disponible. Acordar finalidad, base legal, acceso y retención antes de utilizarlo con usuarios reales.

## 2. Metadatos de una plataforma WebRTC propia

El estándar contempla estadísticas de candidatos ICE con dirección y tipo. Un candidato de retransmisión puede señalar al servidor TURN; la información disponible depende del navegador, SDK y ruta utilizada. Esto describe una posibilidad de diagnóstico en una plataforma que controlen, no una forma de extraer IP de llamadas de aplicaciones ajenas. [W3C: estadísticas WebRTC](https://www.w3.org/TR/webrtc-stats/).

Próximos pasos:

1. Evaluar esta opción solo si el llamante entra a una llamada de su propia plataforma.
2. Verificar qué metadatos oficiales facilita el SDK, con participantes de prueba informados.
3. Diferenciar extremo, proxy y relay; respetar las opciones de privacidad del servicio.
4. Documentar cuándo la dirección no está disponible o no corresponde al dispositivo remoto. No presentar un servidor de retransmisión como ubicación del llamante.

## 3. Estimación de ubicación mediante una IP ya obtenida legítimamente

Una base o servicio GeoIP puede estimar país o región y, a veces, ciudad. MaxMind indica que esos resultados no localizan una vivienda o persona; móviles, VPN y proxies introducen limitaciones. Es importante conservar la incertidumbre o radio de precisión informado. [MaxMind: precisión y limitaciones](https://support.maxmind.com/knowledge-base/articles/maxmind-geolocation-accuracy).

Próximos pasos:

1. Comprobar primero a quién corresponde la conexión observada; una IP de proveedor no sirve para ubicar al interlocutor.
2. Evaluar una base GeoIP local o un proveedor, considerando la licencia y el tratamiento de datos. No enviar direcciones reales a servicios externos de prueba sin una base y autorización adecuadas.
3. Conservar fecha de consulta, versión de la base, región estimada y precisión cuando existan.
4. Presentar el resultado como zona estimada de la conexión, con un área de incertidumbre; no como domicilio ni posición GPS.

## 4. Ubicación compartida con permiso

Una app o página propia puede solicitar una ubicación al dispositivo que la abre. La API web exige permiso expreso; Android permite que la persona conceda solo ubicación aproximada. El permiso en el teléfono del receptor ubica a ese receptor, no al llamante. [W3C: Geolocation](https://www.w3.org/TR/geolocation/), [Android: permisos de ubicación](https://developer.android.com/develop/sensors-and-location/location/permissions/runtime).

Próximos pasos:

1. Definir una función voluntaria que explique quién recibirá la ubicación, para qué y durante cuánto tiempo se conservará.
2. Usar un canal propio seguro y una acción explícita para compartir; respetar rechazo y revocación.
3. Registrar coordenadas, precisión, fecha y constancia de autorización disponibles, asociadas a la sesión de verificación.
4. Indicar que la posición corresponde al dispositivo que compartió. No demuestra por sí sola que sea el mismo aparato desde el que se inició la llamada.

Es viable para una demostración con voluntarios o una función de ayuda al usuario protegido. Requiere cooperación; no garantiza localizar a quien intenta estafar.

## 5. Operador y autoridad competente

Para investigar el origen o la ubicación de un teléfono en llamadas convencionales, la ruta pertinente es la intervención de los operadores mediante los procedimientos de las autoridades competentes. En Perú existe un marco sobre uso de datos de telecomunicaciones para identificación y geolocalización; el Decreto Legislativo 1182 tiene modificaciones, incluida la norma 1688. Su existencia no da a una app acceso directo a esos datos. [MTC: norma y modificación relacionada](https://www.gob.pe/institucion/mtc/normas-legales/6060978-1182).

Próximos pasos:

1. Conservar número mostrado sin alterarlo, número destinatario, inicio y fin con zona horaria, proveedor e identificadores de llamada y desvío disponibles.
2. Asociar los documentos o registros originales que la víctima tenga y un relato revisado por ella; no rellenar los datos desconocidos con inferencias de IA.
3. Consultar al proveedor el canal de reporte de abuso y preservación de registros. Solicitar preservación no equivale a tener derecho a recibir datos de terceros.
4. Preparar la denuncia y documentación para que la autoridad evalúe las diligencias y solicitudes que correspondan. No prometer una ubicación precisa, un nombre ni un plazo de respuesta.

## Límites importantes para la demo

- **WhatsApp:** puede retransmitir llamadas para ocultar la IP; las llamadas grupales ya usan retransmisión según su ayuda oficial. No es una vía general y fiable para obtener la IP del interlocutor desde una app externa. [WhatsApp: protección de IP](https://faq.whatsapp.com/2635108359972899/?cms_platform=android).
- **Audio:** analizar la voz no proporciona por sí solo la IP ni coordenadas del dispositivo; los datos de red son metadatos separados.
- **Número telefónico:** el prefijo o una etiqueta geográfica no demuestran ubicación actual; el número mostrado puede estar enmascarado. [OSIPTEL: enmascaramiento de llamadas](https://www.osiptel.gob.pe/media/kf3dxlll/8-12-04-2023-informe-062-2023.pdf).

## Orden sugerido de evaluación

1. Identificar el proveedor y el transporte real del flujo ya construido.
2. Pedir un inventario de los metadatos oficiales que facilita y distinguir cada participante de la conexión.
3. Probar con dispositivos y cuentas del equipo; decidir si existe una IP del extremo que tenga sentido conservar.
4. Evaluar GeoIP solo como aproximación de esa conexión. Si se requieren coordenadas, optar por compartir ubicación con permiso.
5. Para incidentes reales, priorizar registros trazables que ayuden a una investigación formal. Si no hay datos disponibles, mostrar «no disponible».

La recopilación para seguridad requiere definir una base legal y las condiciones de tratamiento; recibir una llamada o desplegar una app no concede por sí mismo autorización para localizar a otra persona. Este documento propone vías condicionadas y no declara legal cualquier uso de esos datos.
