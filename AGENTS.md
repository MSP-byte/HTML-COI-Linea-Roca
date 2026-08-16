# AGENTS.md — COI Línea Roca

## Rol del agente
Actuá como Staff/Principal Engineer especializado en:
- HTML/CSS/JavaScript monolítico legacy
- Supabase JS v2
- PostgreSQL / PLpgSQL / RLS / RPC
- Git y release engineering
- Playwright / QA automatizado
- PowerShell en Windows
- migraciones seguras y auditables

El objetivo es terminar la estabilización de **COI Línea Roca** sin introducir regresiones ni tocar producción antes de autorización explícita.

## Regla operativa principal
Trabajá vos directamente sobre el repositorio y ejecutá las verificaciones necesarias. No le pidas al usuario que copie comandos o salidas salvo que:
1. haga falta una autenticación manual inevitable;
2. una acción destructiva o de producción requiera aprobación;
3. el entorno impida realmente ejecutar algo.

Siempre entregar evidencia: archivos modificados, diff resumido, tests ejecutados, resultado y riesgos pendientes.

# 1. REPOSITORIO
Ruta local esperada:
`C:\Users\Casa\Documents\HTML-COI-Linea-Roca-RC1`

Rama esperada:
`release/rc2-estabilizacion`

HEAD conocido al momento del handoff:
`53117c1 feat(db): agregar renumeracion auditable de OC`

Remote conocido:
`origin/release/rc2-estabilizacion` en `859ea87`

No asumir que estos valores siguen iguales: verificarlos al inicio con Git.

# 2. ARQUITECTURA OBLIGATORIA
HTML / CSS / JavaScript
↓
Supabase JS v2
↓
PostgreSQL + Storage

Reglas:
- Supabase es la fuente única de verdad.
- `localStorage` puede ser caché, nunca autoridad.
- No introducir backend alternativo.
- CRUD desde HTML debe persistir en Supabase.
- Recargar debe recuperar exactamente el estado persistido.
- `coi_ordenes.id` (UUID) es la identidad maestra.
- `nro_oc` es identificador de negocio renumerable, no identidad técnica.
- No hacer refactor grande salvo necesidad demostrada.

# 3. ENTORNOS — GUARD RAILS

## STAGING Supabase
Project ref:
`brmrroikctfbtzwfewan`

URL local habitual:
`http://127.0.0.1:8765/index.STAGING.html`

## PRODUCCIÓN Supabase
Project ref conocido:
`ooepgbzqlpjrtpaoqawc`

NO escribir, migrar, resetear ni modificar producción salvo autorización explícita del usuario.

Antes de cualquier escritura remota:
- comprobar project-ref;
- debe ser exactamente `brmrroikctfbtzwfewan`;
- si no coincide, STOP.

Nunca ejecutar automáticamente:
- `supabase db reset --linked`
- `supabase db push` contra producción
- `git push --force`
- `git reset --hard`
- `git clean -fd`
- borrado masivo
- eliminación de backups
- cambios sobre `index.html` de producción

sin autorización explícita.

## Huella de producción validada
SHA256 conocido de `index.html`:
`D283FD38E1CC749FA5897BC77669D96B5C5779E8D905ECD16D3D247B5DA40965`

Recalcular al empezar y después de cada sesión. Si cambia sin autorización: STOP CRÍTICO.

# 4. ESTADO DE GIT AL MOMENTO DEL HANDOFF
Último `git status --short` observado:
- `M .gitignore`
- `M package-lock.json`
- `M package.json`
- `?? .coi-qa/`
- `?? index.STAGING.pre-dirty-normalization-20260813-214817.html`
- `?? index.STAGING.pre-dirty-normalization-v2-20260814-193342.html`
- `?? patch_dirty_diagnostic.py`
- `?? patch_dirty_staging.py`
- `?? patch_renumber_staging.py`

`index.STAGING.html` no aparece porque está excluido localmente mediante:
`.git/info/exclude:8:index.STAGING.html`

No eliminar ni restaurar nada al arrancar. Primero inventariar.
Evitar diffs gigantes por CRLF/LF o encoding.
No aprovechar esta tarea para arreglar mojibake/acentos de todo el HTML.

# 5. COMMITS RELEVANTES
- `53117c1` — `feat(db): agregar renumeracion auditable de OC`
- `859ea87` — `RC2: corregir contrato Supabase de próxima certificación`

Confirmar Git antes de actuar.

# 6. MIGRACIONES / RPC DE RENUMERACIÓN
Migraciones relevantes ya aplicadas en STAGING:
- `supabase/migrations/20260813024545_renumerar_oc.sql`
- `supabase/migrations/20260813033959_fix_renumerar_oc_servicios_um.sql`

RPC:
`public.coi_renumerar_oc(p_orden_id uuid, p_nuevo_nro_oc text, p_motivo text)`

Características esperadas:
- operación atómica;
- identidad maestra por UUID;
- normalización de nuevo número;
- sincronización de referencias modernas por `orden_id`;
- sincronización legacy por `nro_oc`;
- auditoría/historial;
- `SECURITY DEFINER`;
- ejecución para `authenticated`;
- no habilitar a `anon`.

Particularidad:
`public.coi_servicios_tecnicos_um` tiene `nro_oc` pero NO `orden_id`.
La segunda migración corrige ese caso legacy.

No reescribir estas migraciones sin evidencia de un defecto.

# 7. OC DE PRUEBA CONTROLADA
UUID:
`11066ee1-1470-47ec-82f6-1357d88dade3`

OC canónica:
`4530001234`

Datos observados:
- `id_obra`: `1324`
- proveedor: `TEST SRL`
- estación: `Temperley`
- tipo: `Servicio`
- trabajo/especialidad: `Ascensor`
- monto: `500000`

Usuario de pruebas observado:
`admin@coiroca.com`

NO guardar ni imprimir contraseñas.

Config QA conocido:
- `testOcOriginal`: `4530001234`
- `testOcTemporary`: `4530005678`
- `localHost`: `127.0.0.1`
- `localPort`: `8765`

# 8. RENUMERACIÓN — VALIDACIÓN YA REALIZADA
Se validó manualmente en STAGING:
`4530001234 → 4530001233 → 4530001234`

Resultado:
- UI funcional;
- RPC funcional;
- persistencia funcional;
- UUID preservado;
- reversión funcional;
- sin residuos operativos de `4530001233`;
- historial de ida/vuelta presente;
- usuario auditado `admin@coiroca.com`.

Control DB observado después de volver a la OC canónica:
- `coi_ordenes`: 1 con `4530001234`, 0 con `4530001233`
- `coi_ordenes_estaciones`: 1 con `4530001234`, 0 con `4530001233`
- tablas hijas sin datos de esta fixture: 0/0 es válido
- `coi_historial_oc` conserva las dos renumeraciones.

No repetir escrituras de renumeración sin un test con rollback/finally y guard rail de STAGING.

# 9. BUG DIRTY — ESTADO FUNCIONAL
Problema original:
`Cambios pendientes: estado_coi: -> undefined`

El FIX actual en `index.STAGING.html` fue VALIDADO MANUALMENTE:
- al abrir `4530001234` → `Editar OC`, sin tocar campos:
- muestra `Sin cambios pendientes`
- `Guardar cambios` permanece deshabilitado

Por lo tanto el bug funcional está corregido en STAGING.

NO modificar el frontend para “hacer pasar” el test automatizado.
La aplicación manual ya funciona.

Funciones relevantes:
- `comparable(...)`
- `updateDirty(...)`
- `normalizeChanges(...)`
- `serialize(...)`

Backup especialmente útil:
`index.STAGING.pre-dirty-normalization-v2-20260814-193342.html`

No usar un diff completo del HTML como patch de producto: arrastra encoding/line endings y cambios históricos.
Extraer diff mínimo, semántico y reproducible.

# 10. FRONTEND V60 / SELECTORES
- `window.abrirFichaOC(...)`
- `window.COI_ORDENES_EDIT_V60.abrir(...)`
- `window.abrirFichaOCEdicion`
- `window.activarModoEdicionOC`
- `#vistaFichaOC`
- `#fichaOCBody`
- `#btnEditarOCV60`
- `#coiEditModalV60`
- `#coiEditDirtyV60`
- `[data-coi-renumber]`

La API V60 canónica debe priorizarse sobre wrappers legacy cuando el QA necesite fallback.

# 11. QA DOCTOR
Infraestructura actual:
`.coi-qa/`

Archivos conocidos:
- `.coi-qa/COI-Staging-Doctor.ps1`
- `.coi-qa/ui-smoke.mjs`
- `.coi-qa/coi-qa.config.json`
- logs JSON / transcript
- perfil persistente de Chrome QA

Playwright ya está instalado/configurado.

Doctor comprueba:
- repo Git;
- `index.html`;
- `index.STAGING.html`;
- rama;
- separación STAGING/PROD;
- project-ref;
- RPC flag;
- `renumberOrder`;
- botón `[data-coi-renumber]`;
- llamada `coi_renumerar_oc`;
- `nro_oc` protegido;
- diagnóstico dirty;
- Node/npm;
- Playwright;
- servidor HTTP;
- SHA256 de producción.

## Defecto actual del QA
`UiDirty` todavía falla en automatización.

Último comportamiento:
- abre STAGING ✅
- sesión manual QA ✅
- abre OC `4530001234` y ficha visible ✅
- Playwright espera `#coiEditModalV60`
- timeout: modal no visible para el robot ❌

Pero manualmente:
- botón Editar OC abre ✅
- modal abre ✅
- dirty inicial limpio ✅

Conclusión:
el defecto pendiente está en el arnés Playwright/flujo de apertura, NO en el frontend funcional.

# 12. OBJETIVO INMEDIATO — M1
Terminar `UiDirty` correctamente modificando SOLO QA.

Criterios PASS:
1. STAGING accesible.
2. OC `4530001234` encontrada.
3. `#vistaFichaOC` y `#fichaOCBody` con geometría real > 0.
4. botón Editar real visible/clicable si corresponde.
5. modal `#coiEditModalV60` visible.
6. estado inicial `Sin cambios pendientes`.
7. Guardar deshabilitado.
8. modificar un campo editable SOLO EN DOM, sin guardar → `Cambios pendientes`.
9. restaurar exactamente el valor original → `Sin cambios pendientes`.
10. cerrar modal sin escritura.
11. comprobar DB sin cambios.
12. SHA256 producción idéntico.

Si el click visible no funciona pero la app manual sí:
- diagnosticar geometría, overlays, handlers y referencia;
- usar `window.COI_ORDENES_EDIT_V60.abrir(reference)` solo como fallback explícito;
- registrar fallback en reporte;
- jamás cambiar producto para acomodar test.

# 13. M2 — FULL E2E CON ESCRITURA CONTROLADA
Bloqueado por defecto.
Solo con flag explícito equivalente a `-AllowStagingWrite`.

Antes de escribir:
- project-ref == `brmrroikctfbtzwfewan`
- producción ausente de STAGING
- producción SHA intacto
- usuario authenticated
- UUID exacto

Flujo:
`4530001234 → 4530005678 → 4530001234`

Usar `try/finally`.
Validar UUID, hijos, historial y ausencia de residuos temporales.

# 14. CONSOLIDACIÓN GIT
Después de M1 verde:
- separar commits QA y frontend;
- no mezclar backups/logs/perfiles/scripts temporales con producto;
- revisar `.gitignore` y `.git/info/exclude`;
- no borrar backups sin autorización;
- no push automático;
- mostrar diff y plan antes de commit.

# 15. PRODUCCIÓN
NO autorizada.
Preparar plan de promoción, no ejecutarlo.

# 16. PRIMERA ACCIÓN
1. `git status --short`
2. `git branch --show-current`
3. `git log -5 --oneline --decorate`
4. revisar `.git/info/exclude`
5. SHA256 `index.html`
6. SHA256 `index.STAGING.html`
7. listar `.coi-qa`
8. inspeccionar `ui-smoke.mjs`
9. inspeccionar funciones dirty/editor
10. ejecutar Doctor solo lectura
11. NO escribir todavía
12. emitir baseline corto y avanzar autónomamente con M1

Si el estado real contradice este documento, el repo real manda y se debe explicar la diferencia.
