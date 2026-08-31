# 14 — TECHNICAL DECISIONS

## TD-001 — Supabase fuente única
localStorage solo cache/legacy.

## TD-002 — Single-file
`index.html` sigue como artefacto principal hasta decisión explícita.

## TD-003 — JS vanilla
No framework sin autorización.

## TD-004 — GitHub + PR + CI
Todo cambio relevante por rama/PR/Quality Gate.

## TD-005 — No merge automático
Autorización explícita.

## TD-006 — PDFs desde Supabase Storage
No OneDrive legacy como autoridad.

## TD-007 — Acta documental como fallback
Puede informar KPI cuando no hay certificación estructurada, marcada `(documental)`, sin inventar período/monto/avance.

## TD-008 — Playwright para regresiones UI
Tests estáticos solo complementarios.

## TD-009 — UM/ST: congelamiento del legado en lugar de importación
Fecha: 2026-08-30. Rama `fix/h05-unidades-mantenimiento-supabase-first`.

Contexto: `coi_unidades_mantenimiento` y `coi_servicios_tecnicos_um` están vacías
en PRODUCCIÓN y en STAGING. El legado local contiene 28 UM y 3 ST de
demostración, inconsistentes entre sí (los ST referencian `UM-001`/`UM-010`,
que no existen entre los códigos `ASC-`/`ESC-`/`BOM-`/`GEN-` de las UM) y
citan OCs (`OC-2025-101/102/103`) que no existen en `coi_ordenes`.

Decisión: **no se importan**. El inventario legado se congela: sus claves siguen
existiendo físicamente hasta H06, pero dejan de ser legibles y escribibles para
los lectores operativos. Remoto vacío es un estado válido y se muestra vacío.

A diferencia de H03, **no hay modo `legacy-readonly`**: allí el legado era
historia pendiente de importar; acá ya se decidió descartarlo.

Consecuencia: el congelamiento debe instalarse **antes** de la llamada síncrona a
`init()`, porque `initUnidadesMantenimiento()` → `cargarUM()` sembraba las 28 UM
de demostración y las persistía en localStorage durante el parseo. La capa H05
propiamente dicha sigue al final del documento, como última autoridad de la vista.

## TD-010 — Baja lógica de UM sin columna `fecha_baja`
Fecha: 2026-08-30.

El esquema canónico de `coi_unidades_mantenimiento` **no tiene** `fecha_alta` ni
`fecha_baja` (ni `tipo`, ni `numero_serie`: son `tipo_um` y `nro_serie`).

Decisión: no se agregan columnas —sería un cambio de schema sin autorización y
una segunda divergencia pendiente contra producción—. La baja es lógica:
`estado = 'BAJA'`, la fecha queda en `fecha_actualizacion` y además se anexa una
marca legible `[BAJA aaaa-mm-dd]` en `observaciones`, con el mismo criterio que
H03 usa para el detalle de resolución.

No existe DELETE físico de UM ni de ST. Un ST fuera de uso pasa a `Cancelado`.

Si más adelante se quiere una columna `fecha_baja` dedicada, requiere migración
autorizada y extender el mecanismo de divergencias del contrato productivo, que
hoy solo contempla acciones ON DELETE de FK.

## TD-011 — UUID como identidad, `codigo_um` como clave de negocio
Fecha: 2026-08-30.

Toda escritura viaja con el `id` uuid. `codigo_um` es atributo UNIQUE y etiqueta
visible. El selector de UM del formulario de ST expone el UUID como `value`: la
UI no vuelve a manejar identificadores legados tipo `UM-001`.

## Formato nueva decisión
ID, fecha, contexto, decisión, alternativas, consecuencias, PR.
