# Hallazgos finales de una llamada: contrato pe-v1

Paso 1 del flujo de informes. Esta entrega guarda datos puntuales y marca que están listos para elaborar el resumen. No llama a Maritime ni genera informes/PDF. Las conversaciones y citas de Comprensión permanecen fuera de este contrato. El audio existente conserva sus rutas, permisos y almacenamiento.

## Flujo del backend de voz

1. Crear el incidente con `POST /api/v1/incidents` indicando `org_id`, `agent_session_id`, `started_at` y el origen `simulated`. La clave de servicio permanece en el backend; la APK utiliza sus tickets de sesión existentes.
2. Si ya se guardó audio de esa sesión, reutilizar el `incident_id` que devuelve su carga: no crear otro incidente. Ese incidente ya tiene `agent_session_id`. El sistema de origen debe registrar la hora real de inicio antes de finalizar; el momento de subida de audio no acredita cuándo comenzó la llamada.
3. Extraer señales e identificadores del contexto autorizado de la llamada. No copiar las citas de Comprensión a `summary`, `explanation` o metadatos. No inventar una IP ni usar el número del tramo Vapi como número del interlocutor original.
4. Al cerrar la llamada, entregar el conjunto completo a `POST /api/v1/incidents/{id}/findings`, con `Authorization: Bearer <clave>` y `X-PhoneWard-Org: <organización>`. La sesión y `simulated` deben coincidir con el incidente; no se asignan por parecido u horario.
5. Reintentar la misma entrega con el mismo `run_id`, revisión y contenido. Una corrección usa un nuevo UUID y una revisión mayor. Las revisiones describen entregas del mismo incidente, no el estado de un informe del modelo.

Ejemplo ficticio:

```json
{
  "schema_version": "pe-v1",
  "run_id": "11111111-1111-4111-8111-111111111111",
  "revision": 1,
  "session_id": "sesion-ficticia-del-backend",
  "simulated": true,
  "ended_at": "2026-10-17T16:00:00-05:00",
  "analysis": {
    "risk_score": 75,
    "verdict": "suspicious",
    "risk_reasons": ["Solicitud de transferencia acompañada de presión"],
    "summary": "Incidente ficticio pendiente de revisión.",
    "recommendation": "Verificar por un canal independiente.",
    "scam_type": "Suplantación bancaria",
    "impersonating": null,
    "model_id": "modelo-del-sistema-de-origen"
  },
  "signals": [
    {"type": "urgencia", "explanation": "Se solicita actuar inmediatamente.", "confidence": 0.8, "source": "ia"}
  ],
  "entities": [
    {"kind": "telefono", "value": "999 888 777", "provenance": "mostrado"},
    {"kind": "cuenta", "value": "191-1234567-0-01", "provenance": "mencionado", "analysis_meta": {"bank": "BCP", "country": "PE"}},
    {"kind": "monto", "value": "S/ 1500.50", "provenance": "mencionado", "analysis_meta": {"currency": "PEN"}}
  ]
}
```

`risk_score` puede ser null si no existe una estimación: no se inventa cero. Se conserva el último valor del incidente y `findings_batch.risk_available=false` indica que esta entrega no contiene una nueva estimación. Un fallo del análisis de origen usa el estado `failed` por el contrato de incidente existente; no debe declararse una entrega final correcta. Arrays vacíos significan que no se extrajeron esos datos, no que el hecho fuera seguro.

## Persistencia y reintentos

La escritura bloquea el incidente y guarda señales, entidades, cierre y constancia en una transacción. `analysis_meta.findings_batch` es de escritura reservada y contiene UUID, revisión, hash y `ready=true` únicamente después de persistir la entrega. `ready` significa listo para generar, no informe elaborado, revisado o aprobado. La procedencia de red existente se conserva.

Se utiliza `actions.kind=findings_committed` para guardar el contenido de cada entrega y su hash; la API CRUD no permite fabricar, convertir, editar ni eliminar esos registros directamente. No es una certificación forense y el borrado del incidente elimina sus dependencias.

Una revisión posterior reemplaza solo las señales/entidades que pertenecían a la entrega anterior. Conserva los aportes de otras rutas. Los duplicados de entidad dentro del mismo incidente se reconocen por tipo y valor normalizado; no representan corroboraciones independientes. La revisión de los vínculos humanos permanece intacta.

No se necesita una migración en este paso. Tampoco se renormalizan datos históricos ni se aplican cambios a Supabase automáticamente. Las comparaciones recalculan la clave desde el valor original para no utilizar los antiguos sufijos recortados.

## Identificadores peruanos

- `telefono`: móvil de nueve dígitos o fijo completo con código de área; se conserva en formato `+51...`. Un fijo local sin área o un número incompatible se conserva como dato sin normalizar y no produce una coincidencia fuerte. Validar el formato no valida titularidad ni operador.
- `cuenta`: dígitos conservando ceros iniciales; `analysis_meta.bank` aporta el banco. Se necesita banco para proponer coincidencia por cuenta. El nombre normalizado del banco forma parte de la clave y evita unir cuentas de bancos distintos.
- `cci`: veinte dígitos, clase distinta de cuenta. No se deduce que dos formatos correspondan a la misma cuenta ni se afirma haber comprobado el dígito de control.
- `billetera`: número peruano y `analysis_meta.wallet` igual a `Yape` o `Plin`. No se equiparan ambas plataformas ni se transforma esa asociación en identidad personal.
- `monto`: conserva decimales y moneda, por ejemplo `PEN:1500.50`. Un monto sin moneda permanece como `moneda_desconocida:1500.50`; no se utiliza para identificar personas.
- `provenance`: `mencionado`, `mostrado`, `reportado_usuario` o `proveedor`. Es el origen declarado del dato, no una verificación de identidad.

Los clientes no deben enviar `normalized` en esta entrega. El servidor lo calcula. El CRUD de entidades también lo recalcula desde el original al crear o cambiar el dato. Los tipos no reconocidos se conservan sin atribuirles coincidencia fuerte.

Referencias: [OSIPTEL: servicio móvil de nueve dígitos](https://www.osiptel.gob.pe/media/z35kail1/resol057-2023-gg-instructivo-tecnico.pdf), [Banco de la Nación: CCI de veinte dígitos](https://www.gob.pe/institucion/bn/noticias/1357021-que-es-el-codigo-interbancario-cci-y-por-que-debes-conocerlo).

## Paso 2: productor y resumen automático con Maritime

El servicio de voz entrega el contexto transitorio del cierre a `POST /api/v1/case-finalizations`. La web comprueba sus permisos, solicita una única generación estructurada al agente Maritime y guarda los hallazgos mediante este contrato. La extracción validada, el resumen, la revisión y el futuro PDF pertenecen a la web. La app móvil no se modifica. Véase [Reportes gestionados por la web](MARITIME_REPORTES.md).

`analysis.generation`, opcional para conservar compatibilidad, contiene `provider=maritime`, `status=completed`, `generation_id`, `prompt_version=pe-report-v1`, `model_id`, `usage` y `limitations`. El contrato aún acepta `xai` para registros históricos; la generación nueva usa Maritime. Solo se acepta con `consent_snapshot.report_storage=true` y `report_sharing=true` vigentes. Se guarda en `analysis_meta.report_generation` con referencia al `run_id`. Los estados running/failed se registran sin inventar un resultado final. El PDF se elaborará en una etapa posterior a solicitud del analista usando el contenido persistido del informe; no se implementa en este paso.
