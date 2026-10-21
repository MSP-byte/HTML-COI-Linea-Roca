# COI V3 — despliegue y recuperación sin pérdida de homologaciones

**Alcance:** migración `202610210002_coi_v3_promocion_homologacion.sql`. Este procedimiento **no autoriza** por sí mismo un despliegue productivo ni reemplaza el control del Issue #139. Aplicar primero en STAGING, con respaldo cifrado recuperable y pruebas aprobadas.

## Contrato y riesgos

La migración crea exclusivamente `coi_v3_promociones`, `coi_v3_procedencia`, `coi_v3_homologaciones` y la RPC `coi_v3_homologar_contrato(uuid,uuid,text,text,text)`; no modifica las 34 OC ni sus 5 certificaciones ni archivos en Storage. El permiso para ejecutar la RPC se concede al rol PostgreSQL `authenticated`, **pero la función comprueba el rol COI `administrador`** y exige huella vigente, coincidencia número/tipo y referencia/observación documental. La función es `SECURITY DEFINER` para registrar en una misma transacción el enlace y su auditoría: debe conservar el guard server-side y `search_path` seguro. No abrir accesos DML directos para homologaciones.

Las referencias de Excel (`nro_oc`) y las candidatas contractuales **no significan vínculos aprobados**. Mantener `orden_id IS NULL` hasta una aprobación documental real; nunca generar OC nuevas para ajustar un número.

## Precheck y pruebas

1. Comprobar entorno exacto (project ref STAGING `brmrroikctfbtzwfewan` / PROD `ooepgbzqlpjrtpaoqawc`), backup externo disponible, ventana de intervención, actor autorizado y SHA del commit de aplicación.
2. Ejecutar `npm test` y Quality Gate Chromium completo. Rechazar cambios con algún job fallido; **no marcar tests `skip` ni suavizar aserciones**.
3. Confirmar que las tres migraciones V3 previas están aplicadas, que no existe discrepancia de esquema y que los usuarios reales mantienen `administrador` o `consulta` como corresponde.
4. Guardar instantánea de valores basales (OC, certificaciones, Storage, usuarios, carteras, enlaces, importaciones y auditorías). Para baseline previo de PROD ver Issue #139; estos valores pueden cambiar, por lo que deben verificarse *en el momento de la ejecución*.
5. Aplicar la migración completa transaccionalmente en el destino **expresamente autorizado** y solicitar recarga PostgREST (`NOTIFY pgrst, 'reload schema'`). No aplicar en PROD si no existe autorización del canal de despliegue.
6. Comprobar las tres tablas con RLS, ausencia de INSERT/UPDATE/DELETE directo para `authenticated` y `anon`, que `anon` no puede ejecutar la RPC y que un usuario `consulta` autenticado recibe `COI_ROLE_REQUIRED` al intentar homologar. La prueba no debe crear vínculos.

## Recuperación: rollback no destructivo de la capacidad de homologar

**No ejecutar `DROP TABLE`, `DELETE`, `TRUNCATE`, `DROP FUNCTION` ni poner `orden_id=NULL` masivamente**: destruiría evidencias o vínculos validados. Si la función presenta una incidencia, congelar nuevas homologaciones primero, registrar evento e impedir nuevas ejecuciones sin quitar los registros.

Con una conexión administrativa **a la base exacta afectada**, ejecutar en una sola transacción:

```sql
BEGIN;
REVOKE EXECUTE ON FUNCTION public.coi_v3_homologar_contrato(uuid,uuid,text,text,text)
  FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.coi_v3_homologar_contrato(uuid,uuid,text,text,text)
  IS 'SUSPENDIDA por contingencia; registros y homologaciones conservados';
COMMIT;
NOTIFY pgrst, 'reload schema';
```

Esta es una suspensión de nuevas homologaciones, **no un rollback de datos**. Mantener `coi_v3_homologaciones`, `coi_v3_cartera.orden_id` y `coi_v3_procedencia` tal como están. Verificar que `has_function_privilege('authenticated', ...,'EXECUTE')` sea `false`, que todo el histórico siga consultable por administradores, y que los conteos/huellas de OC, certificaciones y Storage no hayan cambiado. No revertir `coi_v3_confirmar_importacion` para reintroducir los autovínculos.

### Restablecimiento controlado del servicio

Después de corregir la causa raíz en **una nueva migración versionada**, repetir PGlite, Auth, RLS, Chromium y validación documental; recién entonces autorizar explícitamente la reactivación:

```sql
BEGIN;
GRANT EXECUTE ON FUNCTION public.coi_v3_homologar_contrato(uuid,uuid,text,text,text)
  TO authenticated;
COMMENT ON FUNCTION public.coi_v3_homologar_contrato(uuid,uuid,text,text,text)
  IS 'Homologación habilitada: exige rol administrador y evidencia contractual';
COMMIT;
NOTIFY pgrst, 'reload schema';
```

Esta instrucción presupone que el cuerpo de la función **sigue validando el rol interno**: nunca se debe rehabilitar con código inseguro. Registrar motivo, actor, timestamps, SHA y resultados de QA.

### Restauración de la base (último recurso)

Solo ante corrupción no solucionable, coordinar interrupción de escrituras y restauración **en un proyecto aislado** del backup cifrado #9 mediante el procedimiento probado en GitHub Actions; cotejar integridad y RLS, preparar plan de reemplazo de entorno con responsables y autorizarlo por separado. **Nunca restaurar el backup #9 directamente sobre una producción que ya contenga datos nuevos**: se perderían los cambios posteriores. Si se necesita reparar un vínculo incorrecto, investigar su evidencia, conservar el evento y diseñar corrección compensatoria auditable, no borrar el histórico.

## Criterios para cerrar el Issue #139

Quality Gate 6/6 y sin threads abiertos; migraciones productivas por canal autorizado; transferencia de 133 carteras + 6 lotes + 399 ítems validada sin autovínculos, con procedencia individual y actor original; conteos y hashes de OC y certificaciones antes/después idénticos; prueba JWT `consulta` con acceso de lectura y denegación de importación/homologación; evidencia del backup fuera de GitHub; revisión separada de las 25 OC candidatas y discrepancias de estación/andén.
