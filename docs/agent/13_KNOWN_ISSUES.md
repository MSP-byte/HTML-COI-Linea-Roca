# 13 — KNOWN ISSUES

Documento vivo.

## KI-001 — Duplicación de lógica en index.html
Estado: deuda técnica permanente.
Riesgo: funciones/listeners/globals solapadas.
Mitigación: auditoría, búsqueda previa y tests funcionales.

## KI-002 — Timeline histórico multi-OC
Estado: en seguimiento.
Algunos eventos históricos pueden contener OCs concatenadas.
Regla: recuperar desde evidencia explícita, validar contra OCs reales y no inventar.

## KI-003 — Duplicados documentales históricos
Estado: en seguimiento.
Posibles importaciones/reindexaciones duplicadas.
No borrar sin autorización. Deduplicar lectura de forma segura.

## KI-004 — Playwright/python3 en Windows
Estado: entorno.
El alias python3 puede apuntar a Microsoft Store. No cambiar producción solo por este entorno.

## KI-005 — Tests estáticos insuficientes
Estado: lección incorporada.
Cambios funcionales importantes requieren Playwright real.

## KI-006 — Migracion H03 pendiente de aplicar en remoto
Estado: abierto. PR #58 (rama fix/h03-observaciones-supabase-first).
supabase/migrations/202608300002_h03_observaciones_delete_guard.sql existe en el
repositorio pero NO fue aplicada a Produccion ni a Staging.
Mientras eso siga asi:
- en ambos entornos coi_observaciones_oc.orden_id conserva ON DELETE CASCADE;
- coi_eliminar_orden_integral no comprueba coi_observaciones_oc.
En consecuencia, borrar en remoto una OC cuya unica dependencia sean observaciones
todavia las destruye. La divergencia esta declarada en
tests/fixtures/production_schema_contract.json -> _divergencias_pendientes y la
reporta check_schema_reproducibility.js en cada corrida.
Al aplicarla: actualizar el snapshot productivo y borrar esa entrada.

## KI-007 — Observaciones legacy pendientes de importar
Estado: abierto. Decision aprobada en PR #58.
Mientras un puesto muestre observaciones del legado local (origen legacy-readonly
con filas), la capa H03 bloquea crear, editar, resolver, reabrir y las acciones del
Centro de Alertas, para no poner el marcador de corte antes de haber importado esas
filas a Supabase. Se desbloquea solo cuando la importacion exista y el marcador
quede establecido. La importacion es trabajo posterior a H03.

## Actualización
Registrar PR, fecha, resolución y test de regresión.
