# Security V3 — Corrección focalizada de políticas RLS OC

**Fecha:** 26/10/2026 · **Seguimiento:** Issue #152

## Evidencia previa (lecturas de producción y STAGING)
En `public.coi_ordenes` y `public.coi_ordenes_estaciones` coexisten políticas `*_select_auth` (USING true), `*_update_auth` (USING true / WITH CHECK auth.uid() IS NOT NULL) y `*_insert_auth`, con políticas posteriores basadas en `coi_current_role()`. Por ser políticas PERMISSIVE se combinan con OR, anulando en la práctica el límite por perfil. También quedan políticas antiguas `*_delete_admin` basadas en un email constante.

El riesgo de confidencialidad afecta a cuentas autenticadas sin perfil COI activo; el de integridad a usuarios `consulta` mientras dispongan de permisos SQL de UPDATE (en producción los UPDATE directos de `coi_ordenes` aún tienen GRANT a authenticated). **No equivale a acceso anónimo:** anon no posee permisos directos y las RPC auditadas no tienen EXECUTE anónimo.

## Cambio
Migración `202610260001_security_v3_rls_oc_policies.sql` que, tras comprobar que ambas tablas tienen RLS habilitado y controles por rol para SELECT, INSERT, UPDATE y DELETE, elimina únicamente las 4 políticas legacy por tabla. Se conservan las guardas por rol, grants, funciones, registros y triggers.

**No revoca** en este PR el GRANT UPDATE de producción (tarea posterior tras probar compatibilidad y JWT por roles). **No hay DML ni operaciones sobre OC.**

## QA
- Test en PGlite con dos tablas/roles simulados y control negativo previo: un usuario sin perfil podía leer; luego de migrar no puede.
- Perfil `consulta`: SELECT permitido, UPDATE denegado.
- Perfil `administrador`: UPDATE permitido.
- Se conserva la suite completa, gate HTML/CSS/SQL y Chromium.

## Despliegue y rollback
1. Tras Quality Gate, desplegar primero en STAGING y verificar políticas/grants y flujos con los perfiles disponibles.
2. Aplicar en producción sólo con resultado positivo y comprobación de compatibilidad, sabiendo que STAGING no cuenta actualmente con perfiles reales consulta/editor.
3. Rollback de emergencia: restaurar *definiciones previas exactas* de `pg_policies` bajo control de cambios; no reponer políticas `USING true` sin una alternativa segura. Ninguna tabla ni registro operativo requiere restauración.

**Pendientes fuera de alcance:** el resto de las políticas permisivas legacy en tablas de alertas, documentos, certificaciones, etc.; auditar las 27 advertencias SECURITY DEFINER y probar JWT reales. No se declara seguridad completa.
