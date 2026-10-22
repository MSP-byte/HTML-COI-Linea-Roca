# Security Hardening V2 — Registro de auditoría protegido

**Corte:** 22/10/2026. **Entorno objetivo:** COI Línea Roca. **PR:** #151 (borrador).

## Diagnóstico de seguridad

- PRODUCCIÓN: 27 tablas COI con RLS; sin grants directos del rol anónimo.
- PRODUCCIÓN: `authenticated` conserva `UPDATE` en `public.coi_ordenes`, por compatibilidad legacy, con trigger de control de campos/roles. Debe migrarse gradualmente a RPC-only antes de revocarlo.
- PRODUCCIÓN: helper `public.coi_record_direct_order_update(jsonb,jsonb)` es `SECURITY DEFINER` y es invocable por `authenticated`, lo que permitiría fabricar entradas de auditoría mediante una llamada RPC sin que exista una modificación real.
- STAGING: no conserva la firma pública de ese helper y ya carece de `UPDATE` directo en `coi_ordenes`. La migración condiciona cualquier cambio a la existencia de la firma: en este entorno será NO-OP.
- La primera propuesta de revocar `UPDATE` disparó fallos legítimos de pruebas de compatibilidad (modalidad de certificación), por lo que **se retiró** del PR. El Quality Gate detectó la regresión antes del merge.

## Parche propuesto

La migración `202610220002_security_v2_audit_trigger_only.sql` conserva la función y el evento `ACTUALIZAR_ORDEN_DIRECTO_COMPAT`, pero agrega controles:

1. Rechaza `pg_trigger_depth() < 1` para impedir que un usuario invoque directamente la RPC suministrando JSON libre.
2. Exige identidad activa y valida que OLD/NEW correspondan a la misma OC.
3. Conserva el contrato de auditoría de un UPDATE directo válido.
4. No edita datos, documentos, políticas RLS ni funcionalidades del HTML.

**Riesgo residual**: la comprobación de profundidad de trigger mitiga el uso directo desde PostgREST, pero no reemplaza una implementación en esquema privado ni una validación explícita de todas las RPC. No debe presentarse como seguridad absoluta.

## Gate previo al merge

- Quality Gate completo y `tests/check_supabase_runtime.js` verde.
- Confirmar que el helper no acepta llamadas RPC directas fabricadas.
- Confirmar que un UPDATE legacy autorizado sigue funcionando y auditando.
- Comprobar que `coi_actualizar_orden_integral` sigue funcionando para roles habilitados.
- STAGING: comprobar estado de permisos y compatibilidad del flujo completo.
- Antes de producción, respaldo de `pg_get_functiondef` y revisión de SHA, responsables y ventana de cambio.

## Plan de reversión

Restaurar la definición previa de `public.coi_record_direct_order_update(jsonb,jsonb)` desde respaldo de función, sin tocar registros operativos ni deshabilitar triggers.

## Pendientes posteriores

1. Migrar todas las escrituras directas a RPC y **recién entonces** revocar `UPDATE` a `authenticated`.
2. Auditar las 27 funciones privilegiadas señaladas por Supabase Advisor, con roles reales de prueba.
3. Activar detección de contraseñas filtradas en Supabase Auth y MFA para roles sensibles.
4. Auditar uso de `innerHTML` y endurecer CSP en `index.html` sin perder navegación ni módulos.
5. Auditar exports CSV, dependencias, archivos históricos publicados, respaldos y monitoreo de incidentes.

No es posible certificar “99,9% de seguridad” con un porcentaje orientativo; requiere pruebas dinámicas, revisión independiente y mediciones acordadas.
