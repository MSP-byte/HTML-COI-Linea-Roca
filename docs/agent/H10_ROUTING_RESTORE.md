# H10 — Restauración de ruta inicial

Fecha: 2026-09-08.

Durante la restauración inicial del hash, la aplicación puede repintar vistas mientras espera sesión y snapshots autoritativos. Esos repintados disparan el observador de navegación; si publican la vista transitoria antes de que termine la restauración, una URL solicitada como `#ficha-um/<id>` puede ser reemplazada por `#inicio` y la ruta original queda descartada como obsoleta.

Decisión H10: mientras `restaurar()` está en curso, la publicación automática derivada de repintados queda suspendida mediante el estado `restaurando`. La aplicación del hash solicitado sigue funcionando y, al terminar la restauración —también en salidas tempranas o errores—, se hace una única normalización de URL que describe la pantalla resultante.

La restauración distingue ahora repintados automáticos de navegación real del operador. Un `click` o `change` confiable que efectivamente cambia la ruta visible incrementa una versión independiente de intención de usuario y publica esa nueva ruta; `restaurar()` detecta esa versión y descarta el deep-link capturado al inicio. De esta manera, un click real del sidebar durante un startup lento gana siempre frente a la ruta inicial sin reintroducir la carrera que reemplazaba deep-links por vistas transitorias. La regresión `H10-70` cubre específicamente este caso.

Esto no cambia la autoridad de datos: el hash sigue siendo solo estado de navegación; OC y UM se resuelven contra sus snapshots remotos correspondientes.

La regresión H10-57 refleja el contrato de concurrencia vigente: una pestaña con snapshot obsoleto puede intentar el cierre por la RPC canónica; el repositorio puede retirar `estado_coi='Cerrada'` del patch si la fila remota ya tiene ese valor. La garantía relevante es que el intento de modificar fecha/observación llegue al guard PostgreSQL y sea rechazado, preservando el primer cierre mediante `FOR UPDATE` + guard H10, no mediante un `SELECT` preventivo del navegador.
