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
