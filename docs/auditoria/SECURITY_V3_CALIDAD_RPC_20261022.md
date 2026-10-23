# Security V3 · Migración RPC de control de calidad de órdenes de compra

**Corte:** 22/10/2026. **Issue:** #152. **Base:** main tras PR #155.

## Alcance

Se migra exclusivamente el escritor `actualizarCalidadOrdenSupabase` del módulo ejecutivo de `index.html`, tanto en el control individual como en la auditoría masiva. El flujo previo hacía `UPDATE` PostgREST por `nro_oc`; el nuevo utiliza la RPC existente `coi_actualizar_orden_integral(uuid,jsonb)` con registro de auditoría de servidor.

### Contrato conservado

- Se mantienen exactamente los cinco campos: `calidad_datos_estado`, `calidad_datos_score`, `fecha_ultimo_control`, `requiere_accion`, `motivo_requiere_accion`.
- Se verifica sesión/conexión mediante `requireWrite`, y una consulta `select('id,nro_oc').eq('nro_oc',n).limit(2)` identifica **un UUID único** antes de escribir.
- RPC con `p_orden_id` y `p_cambios`; comprobación de identidad de la OC en la respuesta.
- Relectura `select('*').eq('id',id).limit(1)`; comparación de estado, score, indicador de acción, motivo y presencia de fecha de control; actualización de `mergeRows` únicamente tras confirmación.
- Errores de lectura, denegación de rol, ambigüedad de OC, fallo de RPC y verificación fallida se propagan. No existe fallback a UPDATE directo ni a localStorage.

El contrato SQL existente ya permite los cinco campos y utiliza `coi_assert_role` para autorizar administrador, jefatura, editor, planificación, control y supervisor; **consulta** no tiene autorización RPC. El código conserva la auditoría del servidor.

## QA

- `tests/check_quality_control_rpc_writer.js`: una simulación positiva y siete negativas (OC ausente, duplicada, identidad RPC incorrecta, denegación RPC, confirmación divergente, sesión ausente, error de lookup).
- El inventario automático heredado de #155 debe pasar ahora con **un** escritor directo residual: `updateOrder`.
- Quality Gate: tests estáticos, SQL/PGlite y cuatro shards Chromium, más interacciones; **no mergear si falla**.
- Control futuro en STAGING con identidades reales de los siete perfiles y casos permitidos/denegados. Las simulaciones de Node **no** son pruebas de RLS/Auth sobre datos reales.

## Límites y reversión

Este PR no modifica tablas, políticas, triggers, funciones SQL, roles, Auth, Storage, ni datos de Supabase. Su publicación puede alterar el modo de guardar un control de calidad; es necesario observarlo en STAGING antes de declarar cierre operativo. La auditoría masiva continúa realizando una RPC por OC, no se agregó una transacción global de lote.

El segundo escritor `updateOrder` mantiene UPDATE directo y no debe reemplazarse a ciegas porque maneja renumeración, edición y cierre. **No revocar** UPDATE directo en PRODUCCIÓN hasta migrar ese camino y validar permisos reales por perfil, junto con regresiones de cierre de OC.

Rollback: revertir el commit del PR de manera controlada ante falla confirmada; no revertir cambios SQL o datos, pues este PR no los crea.
