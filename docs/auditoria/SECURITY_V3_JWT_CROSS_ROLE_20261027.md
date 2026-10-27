# COI Línea Roca · QA real de 7 roles / 49 pruebas no mutantes
Fecha: 27/10/2026 · Seguimiento: Issue #152

## Alcance nuevo

El runner `scripts/coi_v3_role_matrix_readonly.cjs` queda preparado para un control **STAGING-only** con 7 cuentas reales, 7 JWT auténticos y un UUID preexistente de OC en STAGING.

Valida para cada perfil:
1. Identidad con `GET /auth/v1/user`, exigiendo siete UUID distintos.
2. Rol del servidor con `GET /rest/v1/rpc/coi_current_role`, exigiendo el rol esperado.
3. Lectura REAL de una OC identificada por `COI_STAGING_OC_FIXTURE_ID`, exigiendo una fila con exactamente ese UUID (no aceptar HTTP 200 con `[]`).
4. Matriz cruzada de 7 x 7 `coi_assert_role(text[])`: cada identidad debe recibir exactamente **1 respuesta aprobada** (su propio rol) y **6 denegaciones** (otros roles), cada denegación **HTTP 403 / SQLSTATE 42501**. Rechaza 404, 429, 5xx y códigos diferentes.
5. Verificación de acceso anónimo: ninguna OC visible y `coi_current_role` inaccesible con HTTP 401/403 y SQLSTATE 42501.

**No se llama a ninguna RPC de mutación** ni se hacen INSERT/UPDATE/DELETE. La única llamada HTTP POST invoca exclusivamente la función SQL **STABLE** `coi_assert_role`, que comprueba rol y no modifica datos. Confirmado por introspección de `pg_proc.provolatile='s'` en ambos entornos (27/10/2026).

## Estado realmente ejecutado al 27/10/2026

- El SQL de seguridad del PR #161 se ejecutó con 7/7 PASS en STAGING y producción, sin escrituras; eso no es una prueba de acceso JWT real.
- STAGING tiene **2 perfiles activos de administrador vinculados a Auth**, y **0 perfiles para las seis categorías restantes**. Es imposible atribuir resultado **49/49 real** antes de provisionar las seis cuentas faltantes con credenciales propias.
- **Mejora aplicada en STAGING** el 27/10: migración de nombre `security_v3_assert_role_invoker_staging_20261027` reutiliza el contenido previsto en `supabase/migrations/202610050003_security_function_surface.sql`: `coi_assert_role(text[])` pasó de SECURITY DEFINER a SECURITY INVOKER; conserva autorización autenticada, niega anon y mantiene `search_path=public, pg_temp`. Verificado con `pg_proc` y grants. Security Advisor STAGING bajó de **27 a 26** advertencias para SECURITY DEFINER. PROD ya estaba en INVOKER; no se modificó.
- Security Advisor PROD: **27** advertencias de funciones privilegiadas accesibles para authenticated. Una función extra, `coi_record_direct_order_update`, es de auditoría en PROD y contiene un control `pg_trigger_depth()`; requiere revisión de compatibilidad antes de revocar permisos.
- Además subsiste **1 advertencia de protección contra contraseñas filtradas por entorno**, configurable desde Auth Dashboard; no se modificó Auth.

## Cómo ejecutar cuando existan las siete identidades de prueba

Requiere variables de entorno `COI_STAGING_API_KEY`, `COI_STAGING_OC_FIXTURE_ID` y `COI_STAGING_JWT_ADMINISTRADOR`, `COI_STAGING_JWT_JEFATURA`, `COI_STAGING_JWT_EDITOR`, `COI_STAGING_JWT_PLANIFICACION`, `COI_STAGING_JWT_CONTROL`, `COI_STAGING_JWT_SUPERVISOR`, `COI_STAGING_JWT_CONSULTA`. Ejecutar localmente:

```sh
node scripts/coi_v3_role_matrix_readonly.cjs
```

El script fuerza la URL exacta `https://brmrroikctfbtzwfewan.supabase.co` y termina sin ejecutarse si faltan JWT, OC fixture o se intenta cambiar a PROD.

**Cuidado con las credenciales:** no colocar JWT, claves ni contraseñas en archivos versionados, logs, issues, conversaciones, capturas o CI sin gestor de secretos y expiración. Usar cuentas dedicadas solo a STAGING y expirar/revocar sus sesiones tras QA. El script no imprime tokens ni IDs de usuario en sus resultados.

## Cobertura y límites

El test CI `tests/check_security_role_matrix_reader.js` **simula** las 49 decisiones en memoria y casos adversos (escalada indebida, HTTP 503, rechazo con código distinto de 42501, lectura vacía, autenticación faltante); no afirma haber ejecutado los 49 casos reales.

**Todavía falta:** provisionar y autenticar las 7 cuentas; ejecutar la matriz **con los 7 JWT reales** y archivar sólo sus resultados sin credenciales; validar por separado permisos de operaciones mutantes en fixtures descartables, cierre OC, almacenamiento de documentos, RPC privilegiadas, MFA, protección contraseñas filtradas, respaldo/restauración y controles de continuidad. Las señales del analizador de código son heurísticas; no sustituyen las autorizaciones de Postgres bajo JWT verdadero.

## Riesgo y rollback

No se ejecuta ningún cambio de base de datos desde GitHub Actions. La corrección de STAGING es compatible con la migración `202610050003_security_function_surface.sql`, que especifica SECURITY INVOKER. Rollback administrativo acotado **solo si el cambio ocasiona una regresión comprobada**: `ALTER FUNCTION public.coi_assert_role(text[]) SECURITY DEFINER;` en STAGING; esa reversión eleva privilegios, por lo que debe evitarse salvo incidente real y documentar su posterior reparación.

El objetivo del 99% es aspiracional; sin pentest y sin matriz de accesos real no existe porcentaje global defensible.
