# H10 — Restauración de ruta inicial

Fecha: 2026-09-08.

Durante la restauración inicial del hash, la aplicación puede repintar vistas mientras espera sesión y snapshots autoritativos. Esos repintados disparan el observador de navegación; si publican la vista transitoria antes de que termine la restauración, una URL solicitada como `#ficha-um/<id>` puede ser reemplazada por `#inicio` y la ruta original queda descartada como obsoleta.

Decisión H10: mientras `restaurar()` está en curso, la publicación automática derivada de repintados queda suspendida mediante el estado `restaurando`. La aplicación del hash solicitado sigue funcionando y, al terminar la restauración —también en salidas tempranas o errores—, se hace una única normalización de URL que describe la pantalla resultante.

La restauración distingue ahora repintados automáticos de navegación real del operador. Un `click` o `change` confiable que efectivamente cambia la ruta visible incrementa una versión independiente de intención de usuario y publica esa nueva ruta; `restaurar()` detecta esa versión y descarta el deep-link capturado al inicio. De esta manera, un click real del sidebar durante un startup lento gana siempre frente a la ruta inicial sin reintroducir la carrera que reemplazaba deep-links por vistas transitorias. La regresión `H10-70` cubre específicamente este caso.

La corrección final refuerza esa regla para el shell V2: cuando un control de navegación declara su destino mediante `data-v2-view`, el destino explícito del click confiable se toma como intención del operador aunque un repintado transitorio ya esté mostrando esa misma vista. Así, elegir «Red» o «Órdenes» durante un arranque lento invalida el deep-link pendiente de forma determinista. En viewport móvil la regresión reproduce además la interacción real del producto: abre `#coiV2Menu`, espera el sidebar off-canvas y luego selecciona el destino; no usa `force` ni saltea el layout.

La regresión `H10-80` quedó alineada con esa interacción real: demora deliberadamente la lectura autoritativa de Órdenes, mantiene pendiente el deep-link inicial y activa por teclado el control V2 visible de Red. El test exige foco real sobre el control y verifica, tanto en desktop como en mobile, que la navegación del operador prevalezca y quede estable en `#red` una vez concluido el arranque. Un acceso rápido oculto de una vista ya reemplazada no se utiliza como sustituto de interacción de usuario.

Esto no cambia la autoridad de datos: el hash sigue siendo solo estado de navegación; OC y UM se resuelven contra sus snapshots remotos correspondientes.

La regresión H10-57 refleja el contrato de concurrencia vigente: una pestaña con snapshot obsoleto puede intentar el cierre por la RPC canónica; el repositorio puede retirar `estado_coi='Cerrada'` del patch si la fila remota ya tiene ese valor. La garantía relevante es que el intento de modificar fecha/observación llegue al guard PostgreSQL y sea rechazado, preservando el primer cierre mediante `FOR UPDATE` + guard H10, no mediante un `SELECT` preventivo del navegador.
