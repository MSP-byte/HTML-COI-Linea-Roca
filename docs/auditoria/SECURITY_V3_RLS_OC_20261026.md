# Security V3 — Limpieza controlada de políticas RLS para OC

**Fecha:** 26/10/2026 · **Seguimiento:** Issue #152 · **Clasificación:** hardening preventivo, no vulnerabilidad de bypass confirmada.

## Evidencia real: STAGING y producción

En `public.coi_ordenes` y `public.coi_ordenes_estaciones` coexisten políticas antiguas `*_select_auth` (USING true), `*_update_auth` (USING true / WITH CHECK auth.uid() IS NOT NULL), `*_insert_auth` y `*_delete_admin` por email, junto con políticas nuevas por `coi_current_role()`.

**Corrección de diagnóstico:** el catálogo `pg_policies.permissive` verifica que las políticas `*_guard` son **RESTRICTIVE**, no PERMISSIVE. En Postgres, la decisión resulta de **(OR entre políticas PERMISSIVE) AND (AND entre políticas RESTRICTIVE)**. Por tanto, en estas dos tablas la guarda de perfil **ya impide** el bypass que se había supuesto al consultar sólo `qual` / `with_check`. El PR elimina redundancia pero no debe venderse como reparación de una vulnerabilidad de RLS demostrada.

STAGING: 1 OC, 1 asociación de estación, 2 perfiles activos administrador y sin `GRANT UPDATE` directo en `coi_ordenes` para authenticated. Producción: 34 OC, 1 perfil administrador y 1 consulta; authenticated mantiene `GRANT UPDATE` directo en `coi_ordenes`, limitado por RLS al rol permitido, aunque no restringido por columnas. El usuario `consulta` no debe modificar registros.

## Cambio acotado

`supabase/migrations/202610260001_security_v3_rls_oc_policies.sql` elimina ocho políticas heredadas (cuatro por tabla) de forma transaccional y conserva:
- Políticas PERMISSIVE basadas en `coi_current_role()` para **SELECT, INSERT, UPDATE y DELETE**.
- Políticas RESTRICTIVE basadas en `coi_current_role()` para los mismos cuatro comandos.
- Todas las funciones, triggers, grants y registros operativos, sin DML.

El script aborta si alguna tabla no tiene RLS, o si falta un par de políticas PERMISSIVE+RESTRICTIVE con validación de rol. Evita que eliminar el último permiso permisivo rompa el acceso operativo.

## Pruebas y criterios de despliegue

- Prueba PGlite reproduce las **dos clases** de políticas y demuestra que, tanto *antes* como *después* de la limpieza: sin perfil no se leen OCs, `consulta` lee sin poder actualizar y `administrador` conserva UPDATE.
- Quality Gate completo y revisión del SQL antes de aplicar a STAGING.
- Aplicar exclusivamente a STAGING primero, comprobar ocho policies ausentes, RLS activo, guardas conservadas, grants sin cambios y mismo número de registros.
- Producción sólo tras homologación por los flujos operativos y matriz JWT real de perfiles. STAGING no dispone hoy de cuentas para seis roles; las simulaciones no equivalen a esas pruebas.

## Rollback y pendiente

Rollback por migración correctiva que restaure las definiciones exactas capturadas de `pg_policies` antes de la operación. No restituir `USING true` como primera opción; priorizar recuperar la funcionalidad con guarda explícita.

Fuera de alcance: las restantes políticas heredadas, permisos SQL por columna, auditoría de 27 advertencias SECURITY DEFINER, Auth/MFA/CSP y validación real JWT. El inventario de 38 políticas legacy no implica 38 vulnerabilidades activas: en el análisis ampliado, 32 combinaciones ampliamente permisivas estaban limitadas por `RESTRICTIVE` de rol y las 3 rutas de escritura de `coi_links_documentales` poseen `RESTRICTIVE false` y carecen de `GRANT` directo.

**No se declara seguridad completa ni bypass demostrado.**
