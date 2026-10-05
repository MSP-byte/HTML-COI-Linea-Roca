# Security Hardening COI Línea Roca — 2026-10-05

## Objetivo

Reducir la superficie de ataque del microaplicativo COI sin modificar reglas
operativas, datos ni comportamiento funcional. El enfoque es defensa en
profundidad: Auth + RLS + grants mínimos + RPC controladas + CI.

## Evidencia live previa

Auditoría realizada contra STAGING y PRODUCCIÓN:

- todas las tablas públicas COI/profiles verificadas tenían RLS habilitada;
- el rol anon no tenía privilegios directos sobre tablas COI;
- el Security Advisor informaba cuatro tablas con RLS habilitada pero sin
  policy explícita;
- authenticated conservaba privilegios estructurales innecesarios
  (TRUNCATE/REFERENCES/TRIGGER) en varias tablas;
- los dos backups históricos de documentos conservaban grants de authenticated
  por un patrón legacy que no cubría correctamente el prefijo completo;
- varias RPC SECURITY DEFINER son intencionales: son endpoints de aplicación con
  validación auth/rol y search_path fijo. No se deben convertir o revocar en
  masa;
- coi_assert_role no necesita SECURITY DEFINER: sólo valida el rol actual
  mediante coi_current_role;
- coi_contractual_capabilities_v1 sólo consulta capacidades del schema y no
  necesita SECURITY DEFINER;
- Supabase Auth mantiene desactivada la protección de contraseñas filtradas
  (acción de configuración externa al schema).

## Cambios versionados

### 202610050002_security_least_privilege.sql

1. Revoca TRUNCATE, REFERENCES y TRIGGER de authenticated en tablas COI/profiles.
2. Refuerza la revocación total de anon.
3. Cierra explícitamente backups coi_documentos_oc_backup_* a public/anon/authenticated.
4. Agrega policy RLS deny-all a backups.
5. Agrega policy RLS deny-all a coi_alertas_revisadas y
   coi_idempotency_requests, que son deliberadamente RPC-only.
6. Convierte coi_contractual_capabilities_v1 a SECURITY INVOKER cuando existe.

### 202610050003_security_function_surface.sql

Convierte coi_assert_role(text[]) a SECURITY INVOKER, preserva search_path fijo,
cierra public/anon y mantiene EXECUTE para authenticated.

## Validación STAGING

Aplicadas ambas migraciones en STAGING.

Resultados:

- desapareció el finding rls_enabled_no_policy;
- authenticated dejó de tener TRUNCATE/REFERENCES/TRIGGER;
- los backups ya no aparecen entre las tablas con grants de authenticated;
- coi_assert_role quedó SECURITY INVOKER, anon sin EXECUTE y authenticated con
  EXECUTE;
- una prueba con identidad administrador confirmó que coi_assert_role sigue
  devolviendo el rol correcto;
- el Security Advisor redujo la superficie SECURITY DEFINER expuesta. Los
  findings restantes requieren clasificación función por función, no un revoke
  masivo.

## Riesgos aceptados / pendientes controlados

- Las RPC SECURITY DEFINER restantes deben conservarse mientras necesiten
  operaciones transaccionales o acceso privilegiado, siempre con auth/role
  interno, search_path fijo y grants explícitos.
- La protección de contraseñas filtradas debe habilitarse en Auth.
- MFA para administradores/jefatura es una mejora recomendada.
- El frontend de 3 MB requiere una auditoría específica de sinks DOM/XSS,
  exportación CSV y CSP. No se declara cerrado hasta revisar el artefacto
  completo.
- Las claves legacy anon pueden deshabilitarse sólo después de confirmar que
  ningún cliente vigente las consume. El frontend documentado usa publishable
  key moderna.

## Rollback

Las migraciones no modifican datos. Ante incompatibilidad:

- restaurar sólo los grants DML estrictamente requeridos por la aplicación;
- retirar las policies deny-all únicamente si se reemplazan por policies
  equivalentes o más restrictivas;
- volver coi_assert_role / coi_contractual_capabilities_v1 a SECURITY DEFINER
  únicamente si una prueba funcional demuestra una dependencia real.

Nunca restaurar TRUNCATE/REFERENCES/TRIGGER al rol authenticated salvo necesidad
técnica demostrada.
