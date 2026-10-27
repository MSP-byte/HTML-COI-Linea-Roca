# COI Línea Roca — Security V3 · controles reproducibles (26/10/2026)

**Meta:** aproximar el sistema a un nivel de seguridad alto mediante evidencia, pruebas negativas y gestión de riesgos, sin inventar un porcentaje de seguridad (99% no es una medida técnica absoluta).

## Qué se verificó efectivamente (lectura real de ambas bases)

Se ejecutó exactamente el SQL de `supabase/qa/security_v3_posture_readonly.sql` mediante conexión administrativa de lectura. No se crearon ni modificaron órdenes, cuentas, privilegios, esquemas o funciones.

| Control | STAGING | PROD | Alcance |
| --- | --- | --- | --- |
| C01 — RLS habilitado en tablas `public` | PASS (27/27) | PASS (27/27) | Tablas ordinarias y particionadas de public; no cubre otras APIs |
| C02 — No permisos de lectura/escritura anónima de tablas | PASS | PASS | GRANT efectivo de SELECT/INSERT/UPDATE/DELETE, incluidos permisos por columna |
| C03 — Sin EXECUTE anónimo en RPC `coi_*` | PASS (56) | PASS (62) | Funciones del esquema public con prefijo coi_ |
| C04 — SECURITY DEFINER sin EXECUTE anónimo | PASS (46) | PASS (49) | No determina autorización de usuarios autenticados |
| C05 — SECURITY DEFINER con `search_path` fijado | PASS | PASS | No certifica seguridad de SQL dinámico ni del cuerpo |
| C06 — Clientes no pueden CREATE en `public` | PASS | PASS | Grants efectivos roles anon/authenticated |
| C07 — Guardas por perfil para `profiles` y `coi_ordenes` | PASS (8/8) | PASS (8/8) | SELECT/INSERT/UPDATE/DELETE con PERMISSIVE+RESTRICTIVE, incluyendo `FOR ALL` y expresiones efectivas por operación |

**IMPORTANTE:** Un 7/7 de esta tabla **no implica** una certificación del 99%, pentest aprobado ni ausencia de vulnerabilidades. Las políticas RLS por rol se combinaron correctamente mediante condiciones PERMISSIVE (OR) y RESTRICTIVE (AND), comprobadas en `pg_policies`.

## Control de regresión en Quality Gate

`tests/check_security_posture_readonly.js` levanta PostgreSQL aislado con PGlite. Ejecuta el SQL real en memoria, verifica siete PASS en el escenario seguro e introduce fallos deliberados:

1. GRANT SELECT accidental a anon: C02 debe fallar.
2. RLS deshabilitada: C01 debe fallar.
3. Eliminación de policy RESTRICTIVE: C07 debe fallar.
4. SECURITY DEFINER sin `search_path` configurado: C05 debe fallar.
5. Permiso `GRANT SELECT(id)` anónimo sobre una columna, sin permiso de tabla: C02 debe fallar.
6. Una policy `FOR ALL` con `USING true` y control por rol sólo en `WITH CHECK`: C07 debe fallar para SELECT/DELETE/UPDATE.
7. Una policy `FOR ALL` con `USING` por rol pero `WITH CHECK true`: C07 debe fallar para UPDATE.

Control positivo adicional: las políticas `FOR ALL` de tipo PERMISSIVE + RESTRICTIVE deben cubrir las cuatro operaciones en C07; quitar la guarda debe volver a hacer fallar C07.

El paso queda en `npm test` con ejecución en GitHub Actions. **Este test no se conecta a STAGING ni PROD**, ni requiere claves. Para auditar en una base real, ejecutar de modo administrativo **solo lectura** el SQL del repositorio y archivar únicamente la tabla de resultados sin credenciales ni datos de OC.

## Brechas abiertas que impiden declarar 99%

- **JWT reales en STAGING:** solo dos identidades con rol administrador; crear seis identidades de prueba distintas y verificar siete roles y operaciones autorizadas/denegadas, incluidos cierre y reapertura de OC, certificaciones, documentación, eliminación y lectura. La herramienta `scripts/coi_v3_role_matrix_readonly.cjs` implementa fase A, necesita una OC fixture y sesiones reales. La fase B requiere diseño e instrumentación con rollback.
- **RPC SECURITY DEFINER:** Supabase Security Advisors informa 27 advertencias en ambos entornos (funciones ejecutables por authenticated), pero son avisos de riesgo, **no 27 vulnerabilidades confirmadas**. Revisar entrada por entrada, argumentos, alcance, errores, idempotencia y privilegios efectivos con JWT, sin revocar masivamente las RPC de operación del COI.
- **Protección contra contraseñas filtradas:** una advertencia en ambos entornos; activar desde Supabase Auth según ajustes disponibles, documentar impacto y verificar que desaparezca (requiere autoridad de administración de Auth).
- **Permisos directos de OC en PROD:** actualmente `authenticated` conserva GRANT UPDATE en `coi_ordenes`, aunque las políticas RESTRICTIVE controlan roles; en STAGING está revocado. No tocar PROD hasta probar los flujos reales de edición y compatibilidad con la ruta RPC-only.
- **Defensas del navegador:** revisión de CSP, rutas de HTML dinámico, CSV/formula injection y protección de sesiones, sin modificar el monolito HTML sin tests focalizados.
- **Disponibilidad y recuperación:** respaldos, controles de restauración, rotación y caducidad de credenciales, plan de respuesta, revisión de dependencias y separación STAGING/PROD.

## Control de cambios y alcance

Esta fase agrega únicamente un archivo SQL de consulta, un test de CI y documentación; no cambia `index.html`, migraciones, datos ni configuración Supabase. El Issue #152 centraliza la trazabilidad. No se debe asignar un porcentaje global sin un inventario de controles ponderados, evidencia actual y evaluación de riesgos residuales.
