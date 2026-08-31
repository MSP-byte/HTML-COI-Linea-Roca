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

## TD-012 — La unicidad del ST es de la base, no del frontend
Fecha: 2026-08-31.

`coi_servicios_tecnicos_um` no tenía UNIQUE (unidad_id, nro_st): la capa H04
evitaba duplicados comprobando antes de insertar. Con dos operadores
concurrentes eso no es integridad —ambos leen «no existe» y después insertan—.

Decisión: la autoridad pasa a PostgreSQL
(`202608310001_h04_st_unique_guard.sql`). La comprobación previa se conserva
porque da un mensaje operativo mucho mejor que un error de base, pero ya no es
la garantía; el 23505 se traduce a un mensaje entendible tanto en alta como en
edición.

Los NULL siguen siendo distintos entre sí: dos ST sin número no colisionan. Es
deliberado, porque `nro_st` es nullable en el esquema aunque la UI lo exija.

Si la migración encontrara duplicados preexistentes, **aborta** informando
cuáles son en lugar de crear el constraint a la fuerza o de «arreglar» filas:
resolverlos es una decisión operativa. Ver [[KI-011]].

## TD-013 — Editar un ST no reasigna su Unidad de Mantenimiento
Fecha: 2026-08-31.

La ficha de UM ahora permite editar un Servicio Técnico existente. La edición va
por UPDATE contra el `id` uuid: nunca inserta una fila nueva ni borra la
anterior. El formulario de edición no ofrece cambiar la UM, porque mover un ST
de un activo a otro no es editar sino reasignar historial técnico, y sería una
operación distinta con otras consecuencias de trazabilidad.

Al comprobar el duplicado (unidad_id, nro_st) se excluye el propio uuid: dejar
el mismo número no es un choque consigo mismo.

Si la OC no se modifica, se conserva la ya persistida sin volver a consultar el
catálogo de Órdenes. Es más seguro (no se acepta ninguna OC nueva sin validar) y
evita bloquear la edición de la descripción solo porque Órdenes todavía no
terminó de cargar. Cambiar la OC sí exige el catálogo, igual que en el alta.

`cambiarEstadoST()` se retiró: existía sin control asociado y el estado pasó a
ser un campo más del formulario de edición.

## TD-014 — La autorización de UM/ST es del servidor, no del navegador
Fecha: 2026-08-31.

Las policies de `coi_unidades_mantenimiento` y `coi_servicios_tecnicos_um` solo
exigían estar autenticado, mientras la UI reservaba las mutaciones al
Administrador. Un perfil `consulta` podía llamar a PostgREST directamente.

Decisión: policies **RESTRICTIVE** que estrechan las permisivas existentes —el
patrón que el proyecto ya usa en `202608100004_rls_policies.sql`—, apoyadas en
`coi_current_role()`. SELECT exige perfil activo; INSERT y UPDATE exigen
`administrador` en USING y en WITH CHECK. No se crea ninguna policy DELETE.

Se eligió RESTRICTIVE en lugar de reescribir las cuatro policies originales
porque estrecha sin tocarlas y porque ninguna permisiva futura puede volver a
ampliar el límite por descuido.

Grants endurecidos como segunda capa: anon pierde todo, authenticated queda con
exactamente SELECT/INSERT/UPDATE. Sin DELETE, TRUNCATE, REFERENCES ni TRIGGER.

`esAdministrador()` sigue en la UI, pero ahora es UX: evita ofrecer controles que
el servidor rechazaría. Ver [[KI-012]].

## TD-015 — El número de ST canónico vive en la base
Fecha: 2026-08-31.

El frontend ya consideraba el mismo ST a `ST-0001`, `st0001` y `ST / 0001`. Un
UNIQUE sobre el texto literal habría sido **más laxo que la propia UI**: dos
clientes concurrentes podían colar variantes equivalentes que después la interfaz
trataría como una sola.

Decisión: la unicidad se aplica sobre
`upper(regexp_replace(nro_st, '[[:space:]./-]+', '', 'g'))`, mediante UNIQUE
INDEX parcial (solo filas con `unidad_id` y `nro_st` no nulos). El valor original
de `nro_st` se conserva para mostrarlo: se normaliza la clave, no el dato.

En el frontend se agregó `claveST()` en lugar de cambiar `clave()`, que usan OC y
UM y además quita acentos: tocarla para todos habría alterado comparaciones
ajenas al problema. `check_h04_st_unique_guard.js` comprueba contra la propia
base que ambas normalizaciones coinciden, para que no se separen con el tiempo.

## TD-016 — Concurrencia optimista en UM y ST
Fecha: 2026-08-31.

`UPDATE ... WHERE id = uuid` sin más permitía que un formulario viejo pisara lo
que otro operador acababa de guardar —incluida una baja, que quedaba revertida en
silencio—.

Decisión: la versión leída (`fecha_actualizacion`) viaja **dentro de la condición
del UPDATE**, no en un SELECT previo: entre un SELECT y un UPDATE separados cabe
perfectamente la escritura del otro operador. Si la condición no coincide, el
UPDATE afecta 0 filas, se relee para distinguir conflicto de falta de permisos y
se informa sin reintentar automáticamente.

Se aplicó también a Servicios Técnicos: el riesgo es idéntico y no tenía sentido
cerrar un lado y dejar el otro abierto. `darDeBajaUM()` usa como versión la fecha
de su propia relectura, de modo que la baja es atómica.

## TD-017 — La baja de UM solo se alcanza por su propia acción
Fecha: 2026-08-31.

`BAJA` figuraba en el select ordinario, así que se podía crear una UM ya dada de
baja, o pasar ACTIVA → BAJA con Guardar, salteando la confirmación, el aviso de
Servicios Técnicos abiertos, la marca `[BAJA aaaa-mm-dd]` y la relectura.

Decisión: se separan `ESTADOS_UM_CANONICOS` (los tres) de
`ESTADOS_UM_ORDINARIOS` (ACTIVA y FUERA DE SERVICIO). El formulario ofrece solo
los ordinarios; la transición a BAJA es exclusiva de `darDeBajaUM()`. Tampoco se
reactiva desde el formulario ordinario, y una UM ya en BAJA conserva ese estado
al editar cualquier otro campo.

Un estado remoto desconocido se sigue conservando: `opcionesSelect()` agrega el
valor vigente cuando no pertenece al catálogo, y guardar sin tocarlo no lo
reescribe. Es dato del servidor.

## Formato nueva decisión
ID, fecha, contexto, decisión, alternativas, consecuencias, PR.
