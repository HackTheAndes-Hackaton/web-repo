# Redes de varios casos

Una red puede reunir dos, tres, veinte o más incidentes. La página Vínculos presenta grupos con todos sus casos, cantidad de conexiones y número de conexiones confirmadas o pendientes. La evidencia detallada puede desplegarse para cada conexión.

## Modelo

Se conservan las conexiones de la tabla `links` como evidencia puntual entre dos casos. A partir de ellas se calculan componentes conectados: si existen A–B y B–C, la interfaz presenta un grupo con A, B y C, sin inventar A–C. Esto permite representar redes de cualquier tamaño sin tablas adicionales, migraciones ni modificaciones del contrato de escritura de los agentes.

Los grupos son una vista exploratoria calculada sobre los datos actuales. Su ancla de navegación no es un identificador persistente de campaña, de perfil vocal ni de persona. No se calcula un porcentaje global ni se atribuye todo el grupo a un mismo hablante.

## Evidencia y revisión

- Cada conexión conserva su puntuación, razones, estado y evidencia revisada. La agrupación no escribe ni recalcula estos datos.
- Una conexión pendiente puede incorporar provisionalmente más casos a una red. Confirmar A–B no confirma B–C ni todo el grupo.
- Las conexiones descartadas no se utilizan para agrupar. Descartar una conexión puente puede dividir un grupo; otras rutas pueden mantenerlo unido.
- La red no mezcla organizaciones, casos reales y simulados, ni datos de origen desconocido con alguno de esos dos conjuntos. Excluye casos sin organización o con compartición revocada.
- Las líneas discontinuas indican conexiones pendientes; las continuas indican revisión confirmada. El grosor sigue representando la puntuación individual de la conexión.

## Detalle de un caso

La sección «Red de casos» muestra todos los otros miembros del grupo y distingue conexiones directas de indirectas. Solo presenta puntuación y evidencia individual cuando existe una conexión directa con el caso abierto. Los casos indirectos enlazan a su ficha y al grupo completo.

La representación de una red no demuestra una campaña única ni identidad personal. Cada afirmación sobre una conexión debe apoyarse en su evidencia y revisión correspondientes.

## Validación

Las pruebas incluyen cadenas de cuatro casos, ciclos, conexiones descartadas que dividen grupos, miembros aislados, registros repetidos, separación por organización y origen, exclusión de compartición revocada y un detalle de tres casos donde el tercero está relacionado indirectamente. También comprueban que la evidencia revisada existente permanece intacta.

## Criterios para proponer una conexión

La IA propone una conexión entre dos casos de la misma organización y origen cuando la puntuación llega a 0,4, o cuando hay una coincidencia fuerte:

- **Número de origen**: las dos llamadas vienen del mismo número (`caller_e164` o `caller_number_raw`), o el número que llamó en un caso se menciona en el otro. Cuenta como dato fuerte. `+51 946…` y `946…` se tratan como el mismo celular. Los números ocultos no se comparan, y el identificador de llamada puede falsificarse.
- **Datos repetidos**: el mismo teléfono o cuenta mencionados en ambos (fuerte) o el mismo nombre (débil).
- **Voz**: similitud de 65 % o más entre muestras utilizables del llamante, con referencia revisada y permiso.
- **Patrón de señales**: 50 % o más de coincidencia en los tipos de señal.

Puntuación sin voz: 0,6 × datos + 0,4 × patrón. Con voz: 0,45 × voz + 0,35 × datos + 0,2 × patrón. Las conexiones se recalculan al escribir por la API o con `POST /api/v1/links/recompute`; los casos con `simulated` desconocido no se recalculan.

## Registro de presuntos estafadores

Desde un grupo de la página Vínculos, un analista puede registrar los casos como obra de un posible mismo estafador y darle un alias (tabla `suspects`, columna `incidents.suspect_id`). El registro guarda notas, estado (en investigación o descartado), quién lo creó y deja una entrada en la bitácora de cada caso. Un caso pertenece a lo sumo a un registro, y la base impide asociar casos de otra organización. Si el grupo crece, la página ofrece agregar los casos nuevos al mismo registro.

El alias sirve para llevar registro y seguimiento. No identifica a una persona ni prueba que todos los casos tengan el mismo autor. También se puede leer y escribir por la API: `/api/v1/suspects` y `PATCH /api/v1/incidents/{id}` con `suspect_id`.
