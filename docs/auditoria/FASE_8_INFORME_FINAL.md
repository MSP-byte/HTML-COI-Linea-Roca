# Fase 8 — Informe final de auditoría

- **Fecha:** 2026-08-11
- **Base auditada:** `main` (`faa4fc9`)
- **Rama de entrega:** `agent/supabase-atomic-contract`
- **Escrituras productivas realizadas:** ninguna

## Resumen ejecutivo

La implementación local queda **🟢 estable bajo la evidencia automatizada
disponible**. El estado general para uso productivo es **🟡 ESTABLE CON
OBSERVACIONES**: las migraciones todavía deben ejecutarse en staging con un
backup verificado, se requiere un smoke autenticado por rol y falta confirmar
el workflow publicado de GitHub Actions.

No quedan bugs conocidos de severidad crítica o alta en el código inspeccionado
y ejercitado localmente. Esto no equivale a afirmar ausencia total de errores ni
autoriza un despliegue directo a producción.

## A. Problemas críticos encontrados

| Prioridad | Problema | Impacto operacional |
| --- | --- | --- |
| P0 | La certificación financiera podía mutar una copia local y mostrar éxito sin commit remoto | Saldos falsos, pérdida al recargar y decisiones basadas en datos no persistidos |
| P0 | Reintentos y doble clic no tenían una idempotencia fuerte | Consumos duplicados y reducción doble del saldo |
| P0 | Ciertos duplicados se podían eliminar automáticamente durante una reparación | Pérdida irreversible de registros sin decisión humana |
| P0 | Cantidades consumidas y saldos podían escribirse desde el navegador | Divergencia entre posiciones, consumos y total de la OC |
| P0 | La autorización dependía parcialmente de UI, email fijo o políticas no uniformes | Operaciones críticas fuera del rol autorizado |
| P1 | OC/estación, circuito/historial y link/principal se actualizaban en requests separados | Estados intermedios o parciales ante error de red |
| P1 | El borrado de una OC podía confirmarse sin un commit integral ni inventario completo de dependencias | OC reaparecida, relaciones huérfanas o trazabilidad destruida |
| P1 | Cachés operativas sobrevivían al logout y el restore podía quedar aplicado parcialmente | Exposición entre sesiones y corrupción local |
| P1 | URLs históricas llegaban a navegación sin una última validación de protocolo | Apertura de esquemas inseguros desde datos legacy |
| P2 | CSV exportado aceptaba prefijos de fórmula y el CDN usaba una versión flotante | Fórmulas al abrir archivos y runtime no reproducible |

## B. Problemas corregidos

- Se reemplazó la fuente financiera local por el libro
  `coi_consumos_posicion`, con locks deterministas, cálculo de saldo por trigger
  e idempotencia ligada al usuario, operación y payload.
- El alta financiera sólo muestra éxito después de la respuesta de
  `coi_certificar_posiciones`; un fallo ambiguo conserva la misma clave para un
  reintento seguro y bloquea un lote diferente hasta reconciliar.
- La corrección financiera ahora anula el asiento, registra motivo/usuario/fecha
  y devuelve el saldo; no borra el libro mayor.
- Las ediciones integrales de OC y estación principal se confirman mediante
  `coi_actualizar_orden_integral` y un trigger valida la cardinalidad.
- El circuito, el historial y los links documentales usan RPC transaccionales e
  índices que garantizan una sola relación principal.
- `coi_eliminar_orden_integral` bloquea cualquier dependencia trazable y sólo
  elimina, en una transacción, una OC libre y sus asociaciones de estación.
- RLS restrictiva y validaciones de rol activo protegen tablas nuevas, núcleo y
  tablas legacy detectadas. Las escrituras directas al ledger, auditoría,
  idempotencia y links quedaron revocadas.
- Logout y pérdida de sesión purgan cachés sensibles; la lectura offline exige
  sesión autenticada. La restauración local revierte si algún paso falla.
- Se fijó `@supabase/supabase-js` en 2.112.2, se revalidan URLs `http/https` al
  navegar y se neutralizan fórmulas en todas las exportaciones CSV encontradas.

## C. Archivos modificados

### Aplicación y configuración

- `index.html`
- `package.json`
- `package-lock.json`
- `playwright.config.js`
- `.gitignore`
- `.github/workflows/quality-gate.yml`

### Contrato de datos

- `supabase/README.md`
- `supabase/migrations/202608100001_preflight_reports.sql`
- `supabase/migrations/202608100002_financial_ledger.sql`
- `supabase/migrations/202608100003_atomic_order_update.sql`
- `supabase/migrations/202608100004_rls_policies.sql`
- `supabase/migrations/202608100005_operational_integrity.sql`

### Pruebas

- `tests/check_control_terceros_static.js`
- `tests/check_crud_ordenes.js`
- `tests/check_integrity_guards.js`
- `tests/check_p0_containment.js`
- `tests/check_supabase_contract.js`
- `tests/check_supabase_runtime.js`
- `tests/delete_button.spec.js`
- `test_imputacion_posiciones.js`

### Documentación

- `README.md`
- `CHANGELOG.md`
- `docs/README.md`
- `docs/auditoria/FASE_1_CRUD_ORDENES.md`
- `docs/auditoria/FASE_3_PLAN_CORRECCION.md`
- `docs/auditoria/FASE_4_CORRECCION_SUPABASE.md`
- `docs/auditoria/FASE_6_7_SEGUNDA_AUDITORIA_ESTABILIZACION.md`
- `docs/auditoria/FASE_8_INFORME_FINAL.md`

## D. Mejoras realizadas

- Frontera clara: Supabase es fuente de verdad; `localStorage` es caché
  autenticada, preferencia o respaldo legacy controlado.
- Mutaciones de negocio compuestas con una sola confirmación transaccional.
- Reintentos seguros y detección de reutilización conflictiva de claves.
- Historial autoritativo: los eventos críticos no se pueden falsificar con un
  `insert` directo desde el cliente.
- Preflight no destructivo e índices que fallan de forma segura ante duplicados.
- Quality gate reproducible con lockfile, controles estáticos, PostgreSQL
  embebido y matriz Playwright desktop/mobile.
- Guías de despliegue, recuperación y troubleshooting del contrato Supabase.

## E. Riesgos que permanecen

| Riesgo | Nivel | Mitigación requerida |
| --- | --- | --- |
| Datos reales pueden contener duplicados o asociaciones incompletas | Alto hasta ejecutar preflight | Backup, staging y resolución manual; no forzar los índices |
| Las políticas históricas del proyecto real pueden diferir de los fixtures | Alto hasta validar staging | Inspección de RLS efectiva y pruebas con cada rol real |
| El frontend sigue concentrado en un HTML de gran tamaño con capas legacy | Medio | Modularización gradual respaldada por caracterización, sin reescritura masiva |
| No se ejecutó la suite completa en un Chromium local por falta del binario | Medio | Ejecutarla en CI y en una estación con `npx playwright install --with-deps chromium` |
| No se ejercitaron Auth, Storage ni red real de Supabase | Medio | Smoke autenticado y controlado en staging, nunca en producción primero |
| La entrega aún no está publicada ni revisada como PR | Operacional | Publicar la rama, revisar el diff y exigir quality gate verde |

## F. Pruebas realizadas

| Prueba ejecutada | Resultado | Tipo de evidencia |
| --- | --- | --- |
| `npm test` | Aprobada | 61 controles base, 39 scripts inline y contratos de integridad |
| Runtime SQL con PGlite | Aprobada | Cinco migraciones, ledger, idempotencia, RLS core/legacy, circuito, links y borrado |
| Fixture financiero | 15/15 aprobadas | Cantidad, importe, saldo, estado y cero escrituras productivas |
| `npm audit --audit-level=high` | 0 vulnerabilidades informadas | Auditoría del árbol npm fijado |
| `git diff --check` | Aprobada | Sin errores de whitespace del parche |
| `npm run test:e2e -- --list` | 8 pruebas descubiertas | Matriz Chromium desktop/mobile cargada correctamente |
| Búsqueda de secretos y sintaxis | Aprobada | Sin `service_role`, claves privadas, conflictos o scripts inválidos |

La ejecución SQL usa PostgreSQL embebido y roles simulados coherentes con el
contrato; no prueba la configuración efectiva del proyecto Supabase remoto.

## G. Pruebas que requieren intervención humana

1. Restaurar un backup reciente en staging y ejecutar el preflight.
2. Resolver manualmente duplicados reportados y aplicar las cinco migraciones en
   orden, verificando la recarga de esquema PostgREST.
3. Probar con usuarios reales activos de cada rol: consulta, editor, jefatura y
   administrador; confirmar también el rechazo de permisos insuficientes.
4. Ejecutar en Chrome y Edge: login/logout, OC, estación principal, posiciones,
   consumo, reintento de red, anulación, circuito, links y borrado bloqueado.
5. Abrir los CSV exportados en Excel/LibreOffice y revisar encoding, separadores
   y neutralización de fórmulas con datos representativos.
6. Verificar consola, trazas de auditoría, caché tras logout y comportamiento
   offline/reconexión sin usar datos productivos.
7. Publicar la rama y exigir el workflow completo verde antes del merge.

## H. Recomendaciones futuras

- Extraer gradualmente configuración, acceso a datos y vistas desde
  `index.html`, conservando un build estático para GitHub Pages.
- Incorporar un proyecto Supabase efímero o staging descartable al CI para
  complementar PGlite con PostgREST/Auth reales.
- Versionar una matriz de permisos por tabla/RPC/rol y revisarla ante cada nueva
  funcionalidad.
- Agregar telemetría no sensible para fallos de RPC, reintentos pendientes y
  divergencias de caché.
- Establecer backups probados, simulacros de restauración y un procedimiento de
  promoción staging → producción con responsable y evidencia firmada.

## I. Estado general del sistema

**🟡 ESTABLE CON OBSERVACIONES**

- **Código inspeccionado:** aplicación, persistencia, dependencias, migraciones,
  RLS y scripts de prueba.
- **Código probado:** controles estáticos, contratos frontend, SQL en PostgreSQL
  embebido, roles simulados e idempotencia.
- **Pruebas simuladas:** integración Supabase mediante PGlite y fixtures locales.
- **Funcionalidades verificadas:** reglas críticas de saldo, anulación, edición de
  OC, circuito, links, borrado, sesión/caché, URL y CSV.
- **No verificado:** proyecto Supabase real, Auth/Storage remoto, navegador con
  sesión real, datos históricos de staging y workflow remoto posterior al push.

El sistema puede pasar a staging con el procedimiento documentado. La promoción
a producción queda condicionada a cerrar las pruebas humanas y remotas de las
secciones E y G.
