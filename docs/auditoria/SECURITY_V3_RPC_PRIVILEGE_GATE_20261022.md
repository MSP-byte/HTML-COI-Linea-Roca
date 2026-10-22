# Security V3 · Inventario de funciones privilegiadas y gate RPC

**Corte:** 22/10/2026. **Alcance:** auditoría reproducible de la superficie PostgreSQL.  
**Estado:** controles de catálogo y pruebas, **sin cambios DDL** sobre los permisos productivos.

## Observación verificada en producción y STAGING

La consulta de catálogo `pg_proc`, `pg_namespace`, `has_function_privilege` y `proconfig` mostró:

- **PRODUCCIÓN:** 27 funciones privilegiadas de `public` y una de `coi_private` con `EXECUTE` para `authenticated`. **Ninguna** se puede invocar como `anon`. Todas tienen `search_path` fijado.
- **STAGING:** 28 funciones privilegiadas accesibles por `authenticated`; ninguna por `anon`; todas con `search_path` fijado. Hay divergencia de identidad de funciones entre entornos que debe quedar documentada: el helper legacy de auditoría de producción no existe en STAGING, mientras `coi_assert_role` fue ajustado en STAGING.
- La función `coi_preflight_integridad` valida la identidad y comprueba directamente `public.profiles` sin usar `coi_current_role`. La función privada `coi_timeline_lock_orders` usa `coi_assert_role`. **No son excepciones sin autorización** por el simple resultado de una búsqueda de nombres.
- Estos resultados de catálogo **no prueban** que todos los controles sean suficientes contra escalada de privilegios, IDOR/BOLA o entradas maliciosas; sólo son el control inicial de superficie.

## Prueba de regresión incorporada

Se extiende `tests/check_security_hardening_v1.js`, que ya levanta el esquema mediante las migraciones reales de GitHub en PGlite:

1. Enumera **todas** las funciones `SECURITY DEFINER` de `public` y `coi_private`.
2. Exige `EXECUTE` efectivo denegado para `anon`.
3. Exige `search_path` explícito para cada función privilegiada.
4. Para las privilegiadas ejecutables como `authenticated`, exige **evidencia sintáctica mínima** de consulta de identidad/rol.
5. Control negativo: concede provisionalmente `EXECUTE` a `anon` en una transacción, verifica la detección, ejecuta `ROLLBACK` y comprueba que el permiso volvió a quedar denegado.

**Límite:** el control de palabras clave para rol es una heurística y no reemplaza probar rutas reales con JWT de cada rol. No modifica contratos, permisos ni datos en Supabase.

## Gating, compatibilidad y siguiente etapa

- El branch nace de `main` después del merge #151 y puede revisarse en paralelo al PR #153 (que elimina HTML legacy).
- Quality Gate completo obligatorio (suite estática, SQL/PGlite y 4 Chromium).
- **No hacer merge** si una función privilegiada nueva queda sin política efectiva o si aparecen regresiones de navegador.
- Siguiente fase: ensayar llamadas REST/RPC permitidas y denegadas usando sesiones de roles diferenciados sobre **datos de prueba** en STAGING, luego migrar los writers directos restantes a RPC transaccionales antes de revocar el `UPDATE` directo en producción.
- Auth Leaked Password Protection y MFA requieren configuración administrativa de Auth y pruebas de acceso/recuperación; no los activa esta prueba.

El objetivo de seguridad está orientado a minimizar riesgo **medible**, no a prometer un porcentaje de 99,9% sin una auditoría externa.
