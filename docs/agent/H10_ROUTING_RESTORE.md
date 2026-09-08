# H10 — Restauración de ruta inicial

Fecha: 2026-09-07.

Durante la restauración inicial del hash, la aplicación puede repintar vistas mientras espera sesión y snapshots autoritativos. Esos repintados disparan el observador de navegación; si publican la vista transitoria antes de que termine la restauración, una URL solicitada como `#ficha-um/<id>` puede ser reemplazada por `#inicio` y la ruta original queda descartada como obsoleta.

Decisión H10: mientras `restaurar()` está en curso, la publicación automática derivada de repintados queda suspendida mediante el estado `restaurando`. La aplicación del hash solicitado sigue funcionando y, al terminar la restauración —también en salidas tempranas o errores—, se hace una única normalización de URL que describe la pantalla resultante.

Esto no cambia la autoridad de datos: el hash sigue siendo solo estado de navegación; OC y UM se resuelven contra sus snapshots remotos correspondientes.

La regresión H10-57 también refleja el contrato de concurrencia vigente: una pestaña con snapshot obsoleto puede intentar el cierre por la RPC canónica; la garantía de preservar el primer cierre está en PostgreSQL (`FOR UPDATE` + guard H10), no en un `SELECT` preventivo del navegador.
