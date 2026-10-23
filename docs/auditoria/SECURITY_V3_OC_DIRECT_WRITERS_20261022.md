# Hardening V3 — Inventario de escritores directos de órdenes de compra

**Corte:** 22/10/2026 · **Origen:** `index.html` canónico del COI Línea Roca · **Issue:** #152.

## Situación real y riesgo

`public.coi_ordenes` mantiene `UPDATE` para `authenticated` en PRODUCCIÓN, junto con RLS y triggers de autorización, por compatibilidad. En STAGING ese permiso directo está revocado. **No son entornos intercambiables para probar el flujo heredado.**

La aplicación ya utiliza las RPC transaccionales `coi_guardar_orden_integral` y `coi_actualizar_orden_integral` en diversos módulos. Sin embargo, se encontraron **dos escritores directos restantes** en el módulo ejecutivo (números de línea del HTML en el baseline posterior al PR #153):

| Writer | Ubicación aproximada | Uso | Compatibilidad RPC |
|---|---:|---|---|
| `updateOrder` | 17065 | Edición de ficha ejecutiva y cierre histórico | **No migrar directamente**: la edición incluye `nro_oc` y posiblemente campos fuera de la allowlist de `coi_actualizar_orden_integral`. Debe separarse renumeración, estado y cambios protegidos y revisar cierres, historial y roles. |
| `actualizarCalidadOrdenSupabase` | 17470 | Indicadores de calidad, control individual y auditoría masiva | Los cinco campos (estado, score, fecha de control, requiere acción, motivo) están en la allowlist de la RPC canónica en PRODUCCIÓN y STAGING. Candidato a migración mínima con resolución de UUID y lectura autoritativa del resultado. |

## Medida implementada: evitar regresión de superficie

`tests/check_legacy_oc_writers_inventory.js` se ejecuta con `npm test`:

1. Verifica la definición del alias `T_ORDENES`.
2. Enumera llamadas mutadoras directas de `coi_ordenes` con forma PostgREST `.from(T_ORDENES).update/insert/delete/upsert` y con nombre literal de la tabla.
3. Impide añadir otros escritores directos fuera de las dos funciones identificadas.
4. Permite que esos escritores se eliminen a medida que se migran a RPC (el contador puede disminuir, no aumentar).
5. Verifica que se mantengan llamadas a las dos RPC canónicas.

El inventario fue contrastado con el HTML vigente. **El test es una protección sintáctica de nuevas superficies, no una protección en tiempo real contra ataques**, y no detecta alias de tabla renombrados o llamadas construidas dinámicamente.

## Secuencia de eliminación efectiva del permiso directo

1. Migrar `actualizarCalidadOrdenSupabase` a `coi_actualizar_orden_integral(uuid,jsonb)` en un PR exclusivo. Resolver UUID por registro canónico, tratar OC ausentes/ambiguas y confirmar el resultado del servidor; probar auditoría masiva y control individual.
2. Auditar y separar cada llamada de `updateOrder`: edición, renumeración, estación, cierre operativo e historial. Evitar que `nro_oc` se modifique por RPC genérica.
3. Ensayar en STAGING permisos por perfiles (consulta, editor, planificación, control, jefatura, administrador), con pruebas negativas y positivas, sin usar datos productivos.
4. Sólo tras confirmar que NO quedan escritores directos y que pasan Quality Gate completo, proponer revocación del `UPDATE` directo en PRODUCCIÓN mediante migración explícita reversible y verificación operativa posterior.

Este PR **no cambia `index.html` ni SQL**, no revoca privilegios ni certifica el sistema como invulnerable. Los riesgos siguen documentados hasta su corrección real.
