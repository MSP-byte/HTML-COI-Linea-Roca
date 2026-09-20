## Objetivo

Publicar el estado RC1 auditado del Sistema COI Línea Roca para revisión y
validación previa a staging, sin realizar deployment, merge ni cambios sobre
producción.

## Cambios realizados

- Supabase consolidado como fuente de verdad operativa.
- Mutaciones críticas trasladadas a RPC transaccionales.
- Caché sensible aislada por sesión y purgada al cerrar sesión.
- Validación reproducible de HTML, CSS, JavaScript, SQL y navegador.
- Quality gate de GitHub Actions preparado para Pull Requests contra `main`.
- Runbook de preproducción, matriz de roles y evidencia RC1 documentados.

## Bugs corregidos

- Eliminación de confirmaciones financieras locales sin commit remoto.
- Protección frente a doble consumo y reutilización conflictiva de claves.
- Cierre del DML directo sobre órdenes y estaciones.
- Alta/edición de OC, CRUD de estaciones y cambio de principal atómicos.
- Rechazo de una OC cuyo total quede por debajo del consumo confirmado.
- Unicidad canónica del número de OC e identidad inmutable de posiciones.
- Diferenciación entre reintento inmediato y reingreso histórico al circuito.
- Corrección del breakpoint de navegación mobile.

## Integridad de datos

- Exactamente una estación principal por OC.
- Ledger financiero, saldos derivados y anulación trazable.
- Constraints, claves, índices y triggers verificados.
- Duplicados reales se informan por preflight y nunca se eliminan
  automáticamente.
- Borrado de OC bloqueado mientras existan dependencias trazables.

## Supabase

RLS y permisos SQL exigen perfil activo y rol autorizado. Las mutaciones core
de órdenes y estaciones sólo pueden ingresar mediante RPC. No se aplicaron
migraciones ni se realizaron escrituras en staging o producción.

## Migraciones incluidas

1. `202608100001_preflight_reports.sql`
2. `202608100002_financial_ledger.sql`
3. `202608100003_atomic_order_update.sql`
4. `202608100004_rls_policies.sql`
5. `202608100005_operational_integrity.sql`
6. `202608110006_release_candidate_hardening.sql`

Las seis fueron aplicadas y reaplicadas correctamente en PostgreSQL embebido.

## Seguridad

- Sin secretos, tokens, contraseñas, claves privadas ni URLs de base con
  credenciales dentro del diff.
- Sin `service_role` ni secretos administrativos en el frontend.
- `.gitignore` protege archivos `.env`, claves locales, credenciales y dumps.
- Workflow con permisos `contents: read` y checkout sin credenciales
  persistentes.
- Ningún deployment automático incluido.

## Tests ejecutados

- `npm ci`
- `npm test`
- `npm audit --audit-level=high`
- validación HTML con `html-validate`
- validación de 27 bloques CSS con `css-tree`
- sintaxis de 39 scripts JavaScript inline
- contrato y runtime SQL con PGlite
- `npx playwright test --list`
- Playwright Chromium desktop/mobile
- `git diff --check`

## Resultados

- 61 controles base aprobados.
- 39/39 scripts JavaScript válidos.
- 27/27 bloques CSS válidos.
- Fixture financiero 15/15 aprobado y cero escrituras productivas.
- Seis migraciones aplicadas y reaplicadas.
- `npm audit`: 0 vulnerabilidades en todos los niveles.
- Playwright: 8/8 aprobadas, 4 desktop y 4 mobile.
- Sin errores inesperados de consola en el smoke local.
- 0 P0 y 0 P1 conocidos corregibles dentro del repositorio.

## Riesgos conocidos

- `index.html` continúa siendo monolítico y conserva capas legacy.
- El test Selenium histórico requiere un ChromeDriver compatible; Playwright es
  el gate de navegador ejecutable y aprobado.
- La evidencia local no sustituye Auth, PostgREST, Storage ni datos reales.
- No se declara el sistema 100 % libre de errores.

## Pendientes de staging

- Crear y verificar backup/restauración.
- Ejecutar el preflight sobre datos reales y resolver hallazgos manualmente.
- Aplicar las seis migraciones en orden.
- Recargar el esquema PostgREST.
- Completar el smoke autenticado con los siete roles core.
- Validar consola, red, auditoría, persistencia, Auth y Storage.

## Rollback

Cada migración es transaccional. Ante un error se detiene la secuencia, se
conserva la evidencia y se restaura el backup verificado. No se improvisan
scripts `down`, no se borran asientos del ledger y no se interviene producción.
El procedimiento completo está en `supabase/PREPRODUCCION.md`.

## Checklist de aprobación

- [ ] Revisar el diff completo y la migración 006.
- [ ] Confirmar ambos jobs de GitHub Actions en verde.
- [ ] Confirmar que no existen secretos en el PR.
- [ ] Aprobar la matriz de roles core e históricos.
- [ ] Verificar backup y capacidad de restauración en staging.
- [ ] Ejecutar preflight con cero anomalías bloqueantes.
- [ ] Aplicar y validar las seis migraciones en staging.
- [ ] Completar smoke autenticado por rol.
- [ ] Revisar auditoría, consola, persistencia y rollback.
- [ ] Mantener el PR sin merge hasta completar la aprobación humana.
- [ ] No desplegar ni migrar producción desde este PR.
