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
Estado: RESUELTO (2026-08-30). Mergeado por PR #58 y aplicado en STAGING y en
PRODUCCION. `coi_observaciones_oc.orden_id` quedo en ON DELETE RESTRICT en ambos
entornos y `coi_eliminar_orden_integral` comprueba la tabla. El snapshot
`tests/fixtures/production_schema_contract.json` ya declara RESTRICT y la entrada
se movio de `_divergencias_pendientes.fk` a `_divergencias_pendientes._resueltas`.
Texto original conservado abajo como historia.

### Texto original
PR #58 (rama fix/h03-observaciones-supabase-first).
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
Estado: RESUELTO (2026-08-30). Se importaron las 4 observaciones canonicas a
PRODUCCION y el marcador de corte quedo establecido, de modo que la capa H03 ya
no bloquea crear, editar, resolver, reabrir ni las acciones del Centro de
Alertas. Texto original conservado abajo como historia.

### Texto original
Decision aprobada en PR #58.
Mientras un puesto muestre observaciones del legado local (origen legacy-readonly
con filas), la capa H03 bloquea crear, editar, resolver, reabrir y las acciones del
Centro de Alertas, para no poner el marcador de corte antes de haber importado esas
filas a Supabase. Se desbloquea solo cuando la importacion exista y el marcador
quede establecido. La importacion es trabajo posterior a H03.

## KI-008 — Migracion H05 pendiente de aplicar en remoto
Estado: abierto. Rama `fix/h05-unidades-mantenimiento-supabase-first`.
`supabase/migrations/202608300003_h05_um_delete_guard.sql` existe en el
repositorio pero NO fue aplicada a PRODUCCION ni a STAGING. Mientras eso siga
asi, en ambos entornos `coi_servicios_tecnicos_um.unidad_id` conserva
ON DELETE CASCADE: un DELETE privilegiado sobre una UM destruiria en silencio
todo su historial de Servicios Tecnicos.

Mitigacion vigente: ni UM ni ST tienen policy DELETE, y la UI no ofrece borrado
fisico (baja logica y cancelacion). La FK RESTRICT es defensa en profundidad
para caminos ajenos a RLS.

La divergencia esta declarada en
`tests/fixtures/production_schema_contract.json` → `_divergencias_pendientes.fk`
y la reporta `check_schema_reproducibility.js` en cada corrida.
Al aplicarla: actualizar el snapshot productivo y mover la entrada a
`_divergencias_pendientes._resueltas`.

## KI-009 — Inventario legado de UM/ST congelado, pendiente de destino final
Estado: abierto. Decision registrada en TD-009.
Las claves legadas de UM y ST (28 UM y 3 ST de demostracion, inconsistentes y no
operativas) NO se importan y NO se borran: quedan congeladas. Los lectores
operativos ven `[]` y las escrituras sobre esas claves se ignoran, de modo que el
contenido historico llega intacto a H06.

Consecuencias a tener presentes:
- un backup creado despues de H05 ya no captura esas claves con contenido;
- restaurar un backup no repone esas claves.
Ambas cosas son deliberadas: ese contenido dejo de ser dato operativo.
El acceso deliberado sigue disponible por `__COI_UM_H05_LEGACY_RAW__` y
`__COI_UM_H05_LEGACY_WRITE__`. H06 decide si se archiva o se elimina.

## KI-010 — Campos de UM del legado sin lugar en el esquema canonico
Estado: abierto (funcional, no bloqueante).
El formulario legado de UM tenia Criticidad, Ubicacion tecnica, OC actual y
Fotos. Ninguno existe en `coi_unidades_mantenimiento`. Para no perder datos en
silencio, H05 dejo de ofrecer esos campos en lugar de aceptarlos y descartarlos:
el filtro de Criticidad se oculta y la tabla muestra columnas reales
(ramal, sector, N° de serie, cantidad de ST).
La relacion con Ordenes se registra ahora en cada Servicio Tecnico (`nro_oc`),
validada contra el catalogo remoto.
Si el negocio necesita criticidad o fotos de UM, requiere migracion autorizada.

## Actualización
Registrar PR, fecha, resolución y test de regresión.
