# Security V3 — updateOrder RPC-only (25/10/2026)

## Alcance exacto
La escritura directa residual del módulo ejecutivo `updateOrder` se migra a la RPC existente `coi_actualizar_orden_integral(uuid,jsonb)`. Se mantienen la ficha ejecutiva, el editor, el cierre y el historial. No se tocan SQL, RLS, Auth, Storage, datos ni permisos productivos.

## Circuito verificable
1. Sesión en línea obligatoria; normalizar y validar N° OC.
2. No aceptar renumeraciones por edición general: la app ya tiene el procedimiento canónico «Cambiar Nro. OC». Si el formulario manda el mismo `nro_oc`, se quita del payload y los otros campos continúan.
3. Lectura remota única (`select('*').eq('nro_oc',n).limit(2)`) y resolución de UUID sin depender de caché.
4. Llamada RPC autorizada por UUID; SQL controla allowlist, roles y auditoría.
5. Identidad confirmada en resultado y relectura por UUID; se comparan todos los valores solicitados antes de refrescar caché y tableros.
6. Se conserva el historial de cambios de campo y el historial explícito de cierre. `fecha_cierre_operativo` se manda como YYYY-MM-DD porque la columna es DATE.
7. Las fallas abortan sin fallback a UPDATE directo ni almacenamiento local como fuente de verdad.

## Verificación de contrato (consulta SQL de catálogo, read-only)
- Producción y STAGING: RPC habilitada para `authenticated`, denegada a `anon`, con allowlist para todos los campos usados por el módulo.
- Producción: `authenticated` aún tiene UPDATE directo por compatibilidad; STAGING no lo tiene. Este PR no cambia permisos.
- Trigger H10 protege cambios de ciclo de vida y auditoría. Los tests de la RPC no reemplazan una prueba end-to-end con identidades reales por rol.

## QA y riesgos
- `tests/check_exec_updateorder_rpc.js`: edición, cierre, edición vacía, renumeración denegada y escenarios negativos (sin sesión, sin OC/duplicado, errores de lookup/RPC/relectura, identidad incorrecta, columnas y valores divergentes).
- Inventario del PR #155 debe llegar a **cero escritores directos detectados** sobre `coi_ordenes`. Es un detector sintáctico, no una prueba de ausencia absoluta de mutaciones.
- Quality Gate obligatorio: estático, SQL/PGlite, cuatro shards Chromium e interacción.
- Antes de revocar UPDATE en producción, probar STAGING con JWT reales para todos los perfiles y una muestra de OC de prueba, con cierres/reaperturas, renumeración, documentación, certificaciones, auditoría y permisos negativos.
- El cambio en el cliente debe auditarse en STAGING antes del despliegue definitivo y sin operaciones sobre OCs productivas.

## Reversión
Revertir el commit del frontend tras confirmar la causa si aparece una regresión. No hay migraciones SQL ni cambios de datos para deshacer. Una vez revocado UPDATE directo, NO revertir a una implementación de escritura directa: reparar la RPC de manera controlada.
