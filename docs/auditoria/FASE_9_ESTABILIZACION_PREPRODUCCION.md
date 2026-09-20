# Fase 9 — Estabilización final y preproducción

- **Fecha:** 2026-08-11
- **Repositorio:** `MSP-byte/HTML-COI-Linea-Roca`
- **Base:** `main` en `faa4fc9`
- **Rama local:** `agent/supabase-atomic-contract`
- **HEAD al iniciar Fase 9:** `1b9a515ccbb3806b0f28ccdafb96ffc711eddce3`
- **Escrituras en producción/staging:** ninguna

Este informe verifica el árbol real y rectifica el alcance de Fase 8. No se
consideró implementada ninguna mejora sólo porque figurara en un documento.

## 1. Fotografía Git antes de modificar Fase 9

| Control | Evidencia inicial |
| --- | --- |
| Branch | `agent/supabase-atomic-contract` |
| Upstream | No configurado; la rama no estaba publicada |
| `git status` | Limpio |
| `git diff` | Vacío |
| HEAD | `1b9a515 Implement atomic Supabase operational contract` |
| Commits anteriores | `0d1fae1 Protect session caches and backup restore`; `32539e8 Make quality gate reproducible`; `7429fae Contain unsafe financial and duplicate mutations` |
| Base local/remota | `main` y `origin/main` en `faa4fc9 Add files via upload` |
| Diff `main...HEAD` | 28 archivos; 3.874 inserciones y 375 eliminaciones |

### Archivos existentes en la entrega antes de Fase 9

**Creados desde `main`:** `.gitignore`, `package.json`, `package-lock.json`,
`supabase/README.md`, las migraciones 001–005, los informes Fase 3/4/6-7/8 y
los tests `check_integrity_guards`, `check_p0_containment`,
`check_supabase_contract` y `check_supabase_runtime`.

**Modificados desde `main`:** workflow, `README.md`, `CHANGELOG.md`, índice de
documentación, Fase 1, `index.html`, configuración Playwright, fixture de
imputación y controles CRUD/terceros/Playwright.

**Eliminados:** ninguno.

### Cambios propios de Fase 9

- nueva migración `202608110006_release_candidate_hardening.sql`;
- preflight 001 ampliado para normalización canónica y estaciones duplicadas;
- frontend migrado a las RPC endurecidas y breakpoint mobile corregido;
- runtime SQL y contratos ampliados; Playwright fortalecido;
- validadores HTML/CSS y quality gate actualizados;
- runbook de preproducción, matriz de roles, rectificación de Fase 8 y paquete
  de publicación agregados.

No se borró ningún archivo. Estos cambios permanecen sin commit para que el
responsable revise el diff final antes de publicarlos.

## 2. Separación entre implementación y recomendación

### A. Problemas detectados y ya corregidos en código

- Los P0 históricos de confirmación financiera local, doble consumo, borrado
  automático de duplicados, saldos escritos por navegador y autorización sólo
  visual están contenidos por ledger/RPC/RLS y pruebas runtime.
- OC/estación, circuito/historial, links y borrado de OC cuentan con fronteras
  transaccionales de servidor.
- Sesión/caché, restore, URLs y CSV conservan los hardenings de Fases 6–8.
- En Fase 9 se cerraron los ocho P1 detallados en la sección siguiente.
- Navegación mobile usa el mismo breakpoint de 760 px que CSS.
- HTML, CSS y JavaScript tienen validaciones reproducibles en el quality gate.

### B. Problemas detectados pero todavía no corregidos

**P0 corregibles dentro del repositorio: 0.**

**P1 corregibles dentro del repositorio: 0.**

Persisten riesgos no P0/P1 o no reproducibles sólo con el repositorio:

- `index.html` continúa siendo monolítico y contiene capas legacy;
- el test Selenium histórico necesita un ChromeDriver compatible;
- no existe evidencia local de Auth, PostgREST, Storage ni datos reales;
- no se ejecutó el workflow remoto porque la rama aún no fue publicada.

### C. Mejoras documentadas pero no implementadas

- modularización gradual del HTML/JS;
- telemetría no sensible de RPC y reintentos;
- proyecto Supabase efímero con Auth/PostgREST en CI;
- simulacros periódicos de backup/restauración;
- decisión y migración de roles históricos opcionales.

Estas mejoras no se contabilizan como correcciones existentes ni bloquean RC1
del repositorio; algunas sí forman parte del endurecimiento futuro.

### D. Cambios que requieren infraestructura externa o credenciales

- backup y restauración verificable de staging;
- aplicación de migraciones a staging y recarga de PostgREST;
- smoke con usuarios reales por rol;
- validación de Auth, Storage, políticas efectivas y datos históricos;
- publicación de rama/PR y ejecución de GitHub Actions;
- cualquier migración o despliegue posterior en producción.

### E. Cambios que requieren decisión humana

- resolver uno por uno los hallazgos del preflight sobre datos reales;
- conservar, mapear o retirar `inspector`, `invitado` y `contratista`;
- aceptar o retirar el test Selenium legacy frente a la suite Playwright;
- aprobar versión/tag, revisión SQL, merge y promoción a producción;
- definir ventana de corte, responsables y criterio de rollback.

## 3. Revisión P0/P1 y causa raíz

No apareció un P0 nuevo. La comparación de Fase 3/Fase 8 contra código real
detectó estos P1, todos corregidos antes de continuar:

| ID | Causa raíz real | Corrección | Evidencia |
| --- | --- | --- | --- |
| P1-9.1 | La migración 004 otorgaba DML a `authenticated`; RLS permitía saltar las RPC de OC/estación | 006 revoca `INSERT/UPDATE/DELETE`; frontend usa sólo RPC | Runtime rechaza DML directo incluso para administrador; búsqueda estática sin DML core |
| P1-9.2 | Cambiar principal usaba tres requests y el CRUD de estaciones no tenía contrato completo | RPC de alta/edición/principal/borrado, triggers diferibles y auditoría | CRUD, espejo OC y cardinalidad aprobados en PGlite |
| P1-9.3 | Funciones auxiliares `security definer` conservaban EXECUTE por defecto | Revocación explícita a `public`, `anon` y `authenticated`; versiones viejas retiradas | Runtime obtiene `permission denied` |
| P1-9.4 | La idempotencia anterior comparaba payload, pero no usuario y operación | `coi_certificar_posiciones_v2` valida los tres elementos antes y después | Reintento único y conflictos de usuario/payload aprobados |
| P1-9.5 | Cualquier etapa vista alguna vez se tomaba como confirmada, aunque el estado actual fuera otro | V2 sólo hace no-op si es la etapa actual; reingreso agrega historial/auditoría | Reintento 0 eventos; reingreso 2 eventos |
| P1-9.6 | El saldo usaba `greatest(...,0)` y ocultaba una OC menor al consumo | `coi_sync_order_balance` aborta con `COI_ORDER_AMOUNT_BELOW_CONSUMED` | Update rechazado y total anterior conservado |
| P1-9.7 | La unicidad comparaba la grafía cruda del número de OC | Normalizador inmutable, preflight, índice funcional y trigger | Alta `OC-453-...` y retry canónico conservan una sola OC |
| P1-9.8 | Los campos de identidad de una posición podían cambiar por update directo | Trigger protege `id`, `orden_id`, `nro_oc` y `posicion`; OC se deriva del padre | Forged OC normalizada y mutación de posición rechazada |

Conclusión: **no quedan P0/P1 conocidos que puedan corregirse únicamente dentro
del repositorio**. Esto no afirma ausencia total de errores.

## 4. Batería ejecutada y evidencia real

| Prueba | Descubierta | Ejecutada | Resultado | Alcance / límite |
| --- | --- | --- | --- | --- |
| `npm ci` | Sí | Sí | ✅ Aprobada | Instalación exacta desde lockfile |
| `npm run validate:html` | Sí | Sí | ✅ Aprobada | `index.html`; excepciones legacy explícitas en `.htmlvalidate.json` |
| `npm run validate:css` | Sí | Sí | ✅ 27/27 bloques | Parseo sintáctico con `css-tree` |
| JavaScript inline | Sí | Sí | ✅ 39 scripts | Extracción y `node --check` por bloque |
| Unitarios/estáticos | Sí | Sí | ✅ Aprobados | 61 controles base, P0, CRUD, terceros, integridad, URL/CSV/caché |
| Fixture financiero | Sí | Sí | ✅ 15/15 | Cálculos, estados, recarga simulada; 0 escrituras productivas |
| Contrato SQL | Sí | Sí | ✅ Aprobado | Orden, funciones, grants/revokes, frontend/RPC |
| Integración PGlite | Sí | Sí | ✅ Aprobada | Seis migraciones aplicadas y reaplicadas; CRUD, RLS, roles, ledger, circuito, links y borrado |
| `npm test` completo | Sí | Sí | ✅ Aprobado | Unitarios + integración |
| `npm audit --audit-level=high` | Sí | Sí | ✅ 0 vulnerabilidades | 0 critical/high/moderate/low reportadas |
| Playwright `--list` | Sí | Sí | ✅ 8 descubiertas | 4 escenarios × desktop/mobile |
| Playwright Chromium | Sí | Sí | ✅ 8/8 en 52,6 s | 4 desktop + 4 mobile; ejecución real, no sólo discovery |
| Consola/página | Sí | Sí | ✅ Sin errores inesperados | Captura `pageerror` y `console.error` en navegación |
| Selenium Python legacy | Sí | Intentada | ⚠️ No ejecutable aquí | Selenium temporal instalado; falta ChromeDriver compatible y Selenium Manager quedó bloqueado al descargarlo |
| ESLint/Stylelint | No existen | No aplica | ⚠️ Sin linter dedicado | HTML/CSS/JS sí tienen validadores reproducibles |

La descarga oficial de Playwright Chromium falló por ZIP truncado/vacío desde
el CDN del entorno. Sin modificar dependencias del proyecto, se extrajo
temporalmente Chromium 149 desde `@sparticuz/chromium` en `/tmp` y se ejecutó:

```bash
COI_CHROMIUM_EXECUTABLE=/tmp/chromium npx playwright test
```

En un entorno normal, el comando canónico sigue siendo:

```bash
npx playwright install --with-deps chromium
npm run test:e2e
```

Para el test Selenium legacy se requiere además ChromeDriver compatible en
`PATH`; no se inventaron credenciales ni se instaló un driver inseguro.

### Cobertura funcional solicitada

| Área | Evidencia local | Límite pendiente |
| --- | --- | --- |
| Desktop/mobile | Playwright 4/4 por proyecto | Navegadores reales adicionales |
| Navegación | Seis módulos, una única vista activa | Sesión remota real |
| Filtros/dashboard | Filtro de período ejercitado en ambas resoluciones | Datos reales representativos |
| CRUD | Alta/edición/borrado de OC, estaciones y posiciones en PGlite; wiring UI estático | Flujo autenticado UI→PostgREST en staging |
| Persistencia | Reconsulta SQL, idempotencia y aislamiento/purga de caché Playwright | Reconexión contra Supabase real |
| Eliminación | OC libre elimina; dependencias/principal/sin sesión bloquean | Confirmación manual con rol real |
| Edición/UI | RPC y actualización de espejo probadas; rutas frontend verificadas | Validación visual con datos reales |
| Cálculos/estados | 15 fixtures + ledger/saldos/circuito runtime | Comparación con históricos de staging |
| Errores | Rechazos sin éxito falso y consola limpia en smoke local | Red/Auth/Storage reales |

## 5. Auditoría de migraciones Supabase

Las cinco migraciones originales fueron auditadas y Fase 9 agregó una sexta
para cerrar P1. La prueba runtime las ordena lexicográficamente, las aplica y
las reaplica sobre PostgreSQL embebido.

| Migración | Dependencias e integridad | Reaplicación | Riesgo de datos / rollback |
| --- | --- | --- | --- |
| 001 `preflight_reports` | Crea/completa `profiles`; normalizador canónico; reporte no destructivo de duplicados y principales | ✅ `IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE` | No fusiona datos. Requiere tablas core preexistentes; conservar reporte |
| 002 `financial_ledger` | Depende de 001 y tablas core; PK/FK/checks, índices, baseline, ledger, idempotencia, auditoría, triggers y RPC | ✅ baseline protegido por meta; reaplicada | Captura consumo histórico y recalcula campos; puede bloquear ante incoherencia. Restaurar backup, no borrar ledger |
| 003 `atomic_order_update` | Depende de helpers/ledger; allowlist, locks, sync de principal y auditoría | ✅ funciones/triggers reemplazables | Cambios futuros son atómicos; no hace reparación masiva |
| 004 `rls_policies` | Habilita RLS, políticas permisivas + restrictivas y grants core | ✅ policies se recrean | Puede cortar accesos de perfiles inválidos. El DML demasiado amplio original queda cerrado por 006 |
| 005 `operational_integrity` | Historial, links, índices únicos, circuito, dependencias, borrado y RLS opcional | ✅ DDL protegido/recreado | Índices fallan ante duplicados; borrado sólo por RPC y sin dependencias; políticas opcionales deben probarse con roles reales |
| 006 `release_candidate_hardening` | Depende de 001–005; unicidad canónica, columnas/constraints de estación, balance estricto, identidad, principal diferible, nuevas RPC y revokes | ✅ cadena completa reaplicada | Backfill de `nro_oc`, recálculo de saldos y creación de índices toman locks y abortan ante duplicados, falta de principal o consumo mayor al total |

### Resultado transversal

- **Orden y dependencias:** 001 → 002 → 003 → 004 → 005 → 006, coherente.
- **Constraints/claves/índices:** PK/FK, checks financieros, unicidad de OC,
  posición, estación y link principal; cardinalidad principal diferible.
- **RLS/políticas:** activas en núcleo; lectura exige perfil activo; auditoría
  restringida; ledger/historial crítico no admiten escritura cliente.
- **Funciones/triggers:** `search_path` fijado, roles revalidados y helpers sin
  EXECUTE público; saldos y espejos se derivan en servidor.
- **Frontend:** no quedan llamadas directas de mutación a órdenes/estaciones ni
  referencias a las versiones retiradas de certificación/circuito.
- **Rollback:** no hay `down` seguro. Cada archivo es transaccional; si el
  conjunto falla se restaura el backup verificado según
  `supabase/PREPRODUCCION.md`.
- **Producción:** no se aplicó ninguna migración.

## 6. Roles y smoke autenticado

Los siete roles core, sus acciones permitidas/prohibidas y el procedimiento de
staging están en `FASE_9_MATRIZ_ROLES.md`. PGlite aprobó lectura para los siete,
edición para los seis roles operativos, creación sólo para
administrador/jefatura/editor y rechazos de consulta/finanzas/borrado.

El smoke completo Auth→PostgREST por rol queda **🔒 pendiente** porque no hay
cuentas ni proyecto staging accesible. No se inventaron credenciales.

## 7. Pipeline CI

El pipeline ya existía en `.github/workflows/quality-gate.yml` y fue auditado.
Ahora valida Pull Requests y `main` con:

- permisos `contents: read` y checkout sin credenciales persistentes;
- Node 22, cache npm y `npm ci`;
- `npm audit --audit-level=high`;
- `npm test`, whitespace, conflictos y DOCTYPE;
- job Chromium dependiente del baseline;
- artefacto Playwright sólo ante fallo;
- timeouts y cancelación de ejecuciones obsoletas;
- **ningún deployment automático**.

La configuración local es válida y profesional para pre-merge. Su ejecución
remota queda pendiente hasta publicar la rama y abrir el PR.

## 8. Repositorio preparado vs publicación GitHub

| Área | Estado |
| --- | --- |
| Repositorio preparado | ✅ Cambios, tests, migraciones, CI, runbook y PR listos para revisión |
| Publicación GitHub | 🔒 Rama sin upstream, sin push y sin PR; no se usaron tokens |

Rama, commit, título, cuerpo y checklist están en
`FASE_9_PUBLICACION_PR.md`. La ausencia de `gh` no bloqueó el trabajo técnico.

## 9. Evaluación RC1

| CONTROL | ESTADO | EVIDENCIA | BLOQUEA PRODUCCIÓN |
| --- | --- | --- | --- |
| P0 corregibles en repositorio | ✅ APROBADO | 0 abiertos tras inspección y regresión | No |
| P1 corregibles en repositorio | ✅ APROBADO | 8 cerrados en Fase 9; runtime/contratos verdes | No |
| Unitarios/estáticos | ✅ APROBADO | `npm test`, 61 controles base y 39 scripts | No |
| Integración SQL | ✅ APROBADO | Seis migraciones aplicadas/reaplicadas en PGlite | No |
| HTML/CSS/JS | ✅ APROBADO | html-validate, 27 estilos, 39 scripts | No |
| npm audit | ✅ APROBADO | 0 vulnerabilidades, incluidas altas/críticas | No |
| Playwright desktop | ✅ APROBADO | 4/4 | No |
| Playwright mobile | ✅ APROBADO | 4/4 | No |
| Consola local | ✅ APROBADO | Sin `pageerror`/`console.error` inesperado | No |
| CRUD principal local | ✅ APROBADO | OC/estaciones/posiciones/ledger en runtime | No |
| Selenium legacy | ⚠️ PENDIENTE | Falta ChromeDriver; cobertura equivalente Playwright verde | No, si Playwright es el gate oficial |
| Integridad de migraciones | ✅ APROBADO | Orden, constraints, RLS, revokes y reaplicación verificados | No |
| CI configurado | ✅ APROBADO | Workflow sin deploy y con quality gates | No |
| CI remoto | 🔒 REQUIERE ACCESO/CREDENCIALES | Rama aún no publicada | Sí para merge |
| Backup/restauración staging | 🔒 REQUIERE ACCESO/CREDENCIALES | Runbook listo, no ejecutado | Sí |
| Preflight sobre datos reales | 🔒 REQUIERE ACCESO/CREDENCIALES | Sólo fixtures locales | Sí |
| Smoke autenticado por rol | 🔒 REQUIERE ACCESO/CREDENCIALES | Matriz lista; sin cuentas reales | Sí |
| Auth/PostgREST/Storage reales | 🔒 REQUIERE ACCESO/CREDENCIALES | No disponibles en el entorno | Sí |
| Resolución de anomalías reales | ⚠️ PENDIENTE | Depende del resultado del preflight | Sí si aparecen |
| Decisión de roles históricos | ⚠️ PENDIENTE | `inspector/invitado/contratista` fuera del core | Sí si existen activos |
| Documentación | ✅ APROBADO | README, changelog, Fase 9, matriz, runbook y PR | No |
| Aprobación de producción | ⚠️ PENDIENTE | Decisión humana posterior a staging | Sí |

## 10. Dictamen

**ESTADO DEL CÓDIGO:** ✅ APROBADO COMO CANDIDATO RC1 LOCAL.

**ESTADO DE RELEASE CANDIDATE:** ✅ RC1 DEL REPOSITORIO. Se cumplen los gates
locales disponibles y no quedan P0/P1 conocidos corregibles en el árbol.

**ESTADO PARA PRODUCCIÓN:** 🔒 NO LISTO. RC1 no equivale a producción.

**BLOQUEANTES RESTANTES:** backup/restauración de staging; preflight y
migraciones sobre datos reales; smoke autenticado por los siete roles;
validación de Auth/PostgREST/Storage; CI remoto verde; resolución humana de
anomalías/roles históricos; aprobación explícita de producción.

**ACCIONES DEL RESPONSABLE, EN ORDEN:**

1. revisar y publicar la rama con el paquete de PR;
2. exigir GitHub Actions verde y revisión SQL;
3. provisionar/confirmar staging y cuentas reales por rol;
4. ejecutar `supabase/PREPRODUCCION.md` desde PRECHECK hasta BACKUP;
5. resolver manualmente cualquier hallazgo y repetir el preflight;
6. aplicar las seis migraciones en staging y validar constraints/RLS/saldos;
7. completar la matriz autenticada, consola, red, auditoría y persistencia;
8. probar restauración/rollback y conservar evidencia;
9. decidir roles históricos y aprobar o rechazar la promoción;
10. sólo entonces repetir backup/migración/smoke con el procedimiento formal de
    producción.

El dictamen es trazable a la evidencia descrita y no declara el sistema 100 %
libre de errores.
