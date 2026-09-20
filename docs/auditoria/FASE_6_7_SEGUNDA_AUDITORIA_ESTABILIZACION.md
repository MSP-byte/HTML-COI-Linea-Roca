# Fases 6 y 7 — Segunda auditoría y estabilización

## Resultado

La segunda inspección se realizó después de las correcciones financieras, de
sesión y de persistencia. Se revisaron nuevamente las mutaciones Supabase, los
límites RLS, los reintentos, el borrado, la caché y las dependencias externas.

| Prioridad | Hallazgo | Corrección | Evidencia |
| --- | --- | --- | --- |
| P1 | Borrado de OC y estaciones en requests separados | `coi_eliminar_orden_integral` bloquea dependencias y hace un solo commit | Runtime: rechazo con trazabilidad y eliminación completa de OC libre |
| P1 | Cambio de etapa e historial con rollback manual | `coi_confirmar_etapa_circuito` serializa por OC y es idempotente por etapa | Runtime: dos llamadas producen una sola confirmación |
| P1 | Link principal actualizado en dos requests | RPC documental e índice único parcial | Runtime: siempre queda como máximo un principal |
| P1 | Tablas legacy sin una frontera RLS uniforme | Guardas restrictivas para tablas detectadas y aislamiento por usuario en sesiones | Contrato SQL y prueba de rol consulta |
| P2 | Dependencia CDN flotante `supabase-js@2` | Versión exacta 2.112.2 en los dos proveedores | Control estático reproducible |
| P2 | Autorización de borrado por email fijo | Perfil `administrador` activo y segunda validación dentro de la RPC | Control CRUD estático y runtime por rol |
| P1 | URLs legacy podían llegar a `href`/`window.open` sólo con escape HTML | Revalidación `http/https` en ficha, alertas, Timeline y expediente | Control estático de las fronteras de navegación |
| P2 | CSV con campos de usuario permitía fórmulas al abrir en Excel | Serializador único neutraliza prefijos `=`, `+`, `-` y `@` | Pruebas de fórmula y números negativos |

## Controles repetidos

- Sintaxis de los 39 scripts inline.
- Estructura HTML y ausencia de IDs estáticos duplicados.
- Contrato financiero, idempotencia y anulación sin borrar el libro mayor.
- Edición integral de OC y estación principal.
- RLS y rechazo de roles sin permiso.
- Circuito, links y borrado de OC en PostgreSQL embebido.
- Auditoría de dependencias npm: cero vulnerabilidades informadas.
- `git diff --check` y búsqueda de secretos privados.

## Límites de la evidencia

- No se ejecutaron escrituras contra el proyecto Supabase real.
- Las cinco migraciones deben validarse primero contra un backup de staging; el
  preflight puede detectar datos históricos que requieran resolución manual.
- El smoke Playwright local requiere descargar Chromium. El entorno de trabajo
  no pudo obtener ese binario; el workflow de GitHub Actions sí instala Chromium
  antes de ejecutar la misma suite.
- Debe completarse un smoke autenticado en staging con perfiles de cada rol y
  verificación visual en Chrome y Edge.

## Estado

- Código y contrato local: **🟢 estable en la evidencia automatizada disponible**.
- Despliegue productivo: **🟡 estable con observaciones** hasta migrar staging,
  ejecutar el smoke autenticado y revisar el resultado de CI.
