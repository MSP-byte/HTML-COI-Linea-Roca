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

## TD-018 — El snapshot remoto confirmado es privado e inmutable
Fecha: 2026-08-31.

`runtime.confirmadoUM` / `runtime.confirmadoST` compartían array —y objetos
fila— con `window.unidadesMantenimiento`, `window.serviciosTecnicos` y
`window.serviciosTecnicosUM`. El legado sigue haciendo `push`, `splice`,
asignación por índice y mutación de filas sobre esas globales (v33GuardarUM, los
helpers ST de R15/R16), así que una escritura local podía contaminar lo que la
capa declaraba «confirmado por Supabase» mientras `sincronizado` seguía en
`true`. `reafirmarEspejo()` no alcanzaba: si el origen ya estaba mutado, reafirmar
propagaba la contaminación.

Decisión: el snapshot confirmado se congela (`Object.freeze` sobre el arreglo y
sobre cada fila) y **nunca se publica por referencia**. El holder guarda su
propia copia, cada lectura de las globales devuelve una copia nueva, y
`reafirmarEspejo()` regenera copias desde el snapshot. Ninguna referencia mutable
se comparte en ninguna dirección.

Congelar además convierte una contaminación silenciosa en un fallo visible: en
modo estricto, intentar mutar el snapshot lanza en lugar de corromperlo.

`sincronizado` vuelve a significar exactamente «esto lo dijo Supabase», nunca una
mezcla con estado local.

## TD-019 — Perfil activo, no solo Auth UID
Fecha: 2026-08-31.

Con las policies RESTRICTIVE de [[TD-014]], un usuario autenticado **sin perfil
activo** tiene `coi_current_role()` NULL y PostgREST le devuelve `[]` sin error:
indistinguible de «el inventario remoto está vacío», que es un estado válido. La
capa habría declarado `sincronizado = true` con 0 UM.

Decisión: antes de aceptar cualquier lectura como autoritativa se confirma el rol
contra el servidor con `rpc('coi_current_role')` —la misma función que evalúan
las policies, para no inventar un segundo criterio de autorización—. Sin rol no
se consulta UM/ST en absoluto y el estado queda `error-sin-sincronizar` con
«El usuario no tiene un perfil activo habilitado».

## TD-020 — La versión del CAS la captura el formulario
Fecha: 2026-08-31.

El control optimista de [[TD-016]] tomaba `fechaActualizacion` del runtime al
guardar. Eso lo derrotaba: si el remoto avanzaba a V2 mientras el formulario
estaba enfocado —y por eso no se repintaba—, el CAS validaba contra V2 y los
inputs V1 pisaban el cambio ajeno con éxito aparente.

Decisión: `umEditandoVersion` y `stEditandoVersion` se fijan **en el momento en
que se pintan los inputs**, y son las que viajan en el UPDATE. Un refresco que no
repinta no puede moverlas. Además la firma del formulario pasa a cubrir todos los
campos que muestra, para que cuando el repintado sí sea posible ocurra.

## TD-021 — Código de UM canónico en la base
Fecha: 2026-08-31.

Mismo razonamiento que [[TD-015]] para el número de ST: el frontend consideraba
la misma UM a `ASC-001`, `asc001` y `ASC / 001`, mientras la base solo tenía el
UNIQUE literal del baseline. La base era **más permisiva que la interfaz**.

Decisión: se agrega un UNIQUE INDEX parcial sobre
`upper(regexp_replace(codigo_um, '[[:space:]./-]+', '', 'g'))`. El constraint
literal del baseline **no se toca**: conviven, y el literal sigue siendo la
unicidad exacta. En el frontend se agregó `claveUM()`, separada de `clave()` y de
`claveST()`: son identificadores técnicos distintos, cada uno con su propio
índice, y compartir la función los ataría sin motivo. Ver [[KI-013]].

## TD-022 — Estado remoto de ST: conservarlo sí, introducirlo no
Fecha: 2026-08-31.

Un ST con estado remoto no canónico (por ejemplo `Mantenimiento`) bloqueaba
cualquier edición: la validación exigía siempre el catálogo, así que no se podía
ni corregir el proveedor.

Decisión: se captura el estado original al entrar en edición. Conservarlo sin
tocarlo es válido —es dato del servidor y el operador no lo introdujo—, pero
sigue prohibido crearlo, cambiar de canónico a desconocido, o pasar de un
desconocido a otro distinto. Resolverlo a un estado canónico siempre se permite.

## TD-023 — Los ST sin UM se muestran, no se adoptan
Fecha: 2026-08-31.

Ver [[KI-014]]. Un ST sin `unidad_id` resoluble quedaba contado en el total
sincronizado pero fuera de toda pantalla. Se agregó un panel de regularización
que los lista con todos sus campos.

Decisión explícita de **no** autoasignarlos a una UM ni crear una UM contenedora:
elegir un destino es una decisión operativa con consecuencias de trazabilidad, y
adivinarla sería peor que mostrar el problema.

## TD-024 — El modo edición de ST pertenece a la ficha donde se inició
Fecha: 2026-08-31.

`stEditandoUuid` sobrevivía a salir de la ficha, así que un alta hecha después en
el panel independiente se interpretaba como UPDATE y podía sobrescribir en
silencio el ST que se estaba editando.

Decisión: el estado se resetea al cambiar de contexto —salir de la ficha,
renderizar el panel de alta, pulsar Limpiar— y no dentro de `guardarST()`.
Además `guardarST()` distingue estructuralmente el contexto por prefijo del
formulario (`stfh5` = ficha, `sth5` = alta): el panel de alta **nunca** hereda
una edición previa. Son dos capas: la primera arregla el estado, la segunda hace
que el contrato sea explícito en lugar de implícito.

## TD-025 — Congelar el legado incluye `clear()`
Fecha: 2026-08-31.

El escudo cubría `getItem`, `setItem` y `removeItem`, pero `limpiarLocal()` de
Administración llama directo a `localStorage.clear()`, que no pasa por
`removeItem`. Como `setItem` sobre esas claves ya estaba bloqueado, un `clear()`
habría destruido el legado **sin manera de reponerlo** antes de H06.

Decisión: `clear()` también se intercepta. Se releen las claves legadas con la
API nativa, se ejecuta el `clear` nativo y se reponen solo esas claves con el
`setItem` **nativo** —el wrapper las bloquea a propósito—. El resto del
almacenamiento se limpia normalmente y el intento queda registrado.

Esto es preservación física hasta H06, no reactivación operacional: los lectores
operativos siguen viendo `[]`.

## TD-026 — La OC de un ST se valida contra Supabase, no contra la caché
Fecha: 2026-08-31.

`resolverOC()` validaba contra `todasLasOC()`, que el módulo de Órdenes puede
estar sirviendo desde su caché local cuando su propia lectura remota falla. Una
OC eliminada o cerrada seguiría figurando ahí y quedaría persistida como
asociación obsoleta del ST.

Decisión: crear un ST con OC, o cambiar la OC de uno existente, exige confirmar
contra `coi_ordenes` en Supabase. Si la lectura remota falla **no se guarda**:
una asociación sin validar es peor que no guardar nada. Nunca se crea una OC.

Se mantiene [[TD-013]]: si la OC persistida no fue modificada, se conserva sin
revalidar. Eso no relaja nada —no entra ninguna OC nueva sin confirmar— y evita
bloquear la edición de otro campo por una validación que no hace falta.

El catálogo en memoria se sigue usando para avisar temprano, pero ya no decide.

## TD-027 — La estación se compara normalizada, el dato no se toca
Fecha: 2026-08-31.

`umsPorEstacion()` resolvía bien por el catálogo maestro, pero caía a comparación
**exacta** cuando la estación no estaba catalogada. Verificado: con
`ESTACION SIN CATALOGO` en Supabase, buscar `Estación Sin Catálogo` o
`estacion sin catalogo` devolvía 0 UM, así que la Red podía mostrar el activo
como inexistente mientras Administración lo listaba.

Decisión: se normaliza la **comparación**, nunca el valor almacenado. Se
reutiliza el canonicalizador del proyecto (`resolverEstacionMaestra` y
`normalizarNombreEstacion`) y solo se cae a una clave equivalente —sin acentos,
mayúsculas, espacios colapsados— si esos helpers no estuvieran disponibles.
Primero se compara por identidad del catálogo maestro; el nombre normalizado es
el respaldo. Ninguna rama compara texto exacto.

## TD-028 — La asociación ST → OC es integridad referencial, no texto validado
Fecha: 2026-08-31.

La asociación la sostenía el frontend: `SELECT` para validar y después
`INSERT/UPDATE` para escribir. Eso dejaba tres agujeros que ninguna validación de
navegador cierra:

1. **Normalización.** La identidad de una OC la define
   `coi_normalize_order_number()`. Comparar por texto —exacto o `ilike`— acepta o
   rechaza según cómo el operador escribió el número.
2. **Carrera.** Entre el SELECT que valida y el INSERT que escribe hay una
   ventana: si la OC se elimina en el medio, queda un ST huérfano.
3. **Renumeración.** `coi_renumerar_oc` actualiza `coi_servicios_tecnicos_um.nro_oc`
   pero no necesariamente mueve `fecha_actualizacion`, así que un formulario
   abierto podía reenviar el número viejo.

**Decisión: FK + trigger, no RPC.** Se verificó primero que la arquitectura fuera
viable: `coi_ordenes` ya tiene `coi_ordenes_nro_oc_uq`, un índice único sobre la
columna, y PostgreSQL acepta un índice único como destino de una foreign key
—comprobado sobre PGlite antes de escribir la migración—.

- un trigger `BEFORE INSERT/UPDATE` resuelve el número entrante a la forma exacta
  almacenada, usando `coi_normalize_order_number`;
- la FK con `ON UPDATE CASCADE` propaga las renumeraciones sola;
- la FK con `ON DELETE RESTRICT` impide borrar una OC con historial técnico.

Trigger y FK corren **dentro de la misma sentencia** que la escritura: no queda
ventana de carrera y no hace falta un `SECURITY DEFINER` nuevo con su propia
superficie de permisos. Un número viejo o inexistente deja de poder restaurarse
sin depender de `fecha_actualizacion`.

Dato del schema que conviene tener presente: `coi_order_number_guard` **normaliza
`nro_oc` al escribir la orden**, así que la forma almacenada es siempre la
canónica. El valor del trigger es aceptar lo que el operador escriba
—`4530-008964`, `OC 4530008964`— cuando sin él la FK lo rechazaría.

Consecuencia documentada: con la FK, la cascada renumera los ST antes de que
`coi_renumerar_oc` llegue a su UPDATE explícito, así que ese UPDATE pasa a
afectar 0 filas y su contador informará 0. El dato queda igual de renumerado, por
la cascada. No se reescribe el RPC ya desplegado. Ver [[KI-015]].

En el frontend, además, si el operador no tocó la OC el `nro_oc` **no viaja** en
el patch del UPDATE.

## TD-029 — El chequeo de rol es fail-closed
Fecha: 2026-08-31.

[[TD-019]] cortaba cuando `coi_current_role()` devolvía null, pero seguía adelante
si la RPC fallaba. Un error de red devolvía el control al mismo falso cero que el
guard venía a evitar.

Decisión: la verificación es obligatoria. Sin rol confirmado —null **o** error—
no se consulta UM/ST y el estado queda `error-sin-sincronizar`.

## TD-030 — El formulario se repinta tras una mutación propia
Fecha: 2026-08-31.

El guard que evita repintar mientras el operador escribe también se activaba con
el **botón** enfocado, que es justo donde queda el foco después de Guardar. El
formulario se quedaba con la versión vieja y el siguiente guardado fallaba con un
conflicto de [[TD-020]] que no existía.

Decisión: un botón enfocado no cuenta como «escribiendo», y una mutación propia
confirmada fuerza el repintado desde el snapshot recién leído.

## TD-031 — Comparar estaciones normalizado, seleccionar exacto
Fecha: 2026-08-31.

[[TD-027]] normalizó la comparación, pero el `<select>` heredó esa comparación
para decidir qué opción marcar. Si el catálogo dice `Plaza Constitución` y
Supabase guarda `PLAZA CONSTITUCION`, marcar la variante del catálogo hacía que
guardar cualquier otro campo reescribiera en Supabase un texto que el operador
nunca tocó.

Decisión: la comparación normalizada es para **buscar y contar**; el valor
seleccionado se decide por **igualdad exacta** con el dato remoto, y si no figura
literalmente entre las opciones se agrega una sola vez.

## TD-032 — La prevalidación de OC usa la identidad canónica de PostgreSQL
Fecha: 2026-08-31.

La integridad final ya vive en [[TD-028]] (trigger + FK). Pero la prevalidación
remota del frontend **debe seguir existiendo**: mientras las migraciones de este
PR no estén desplegadas, es la única defensa fail-closed contra asociar un ST a
una OC inexistente.

El problema era que resolvía con `eq()` e `ilike()` sobre el texto crudo. Eso es
una **segunda definición de identidad, más estrecha** que la de PostgreSQL:
`OC 4530008964` o `4530-00.89/64` designan la misma orden para
`coi_normalize_order_number` y para el trigger, pero la UI las rechazaba antes de
intentar escribirlas. Decía que no a algo que la base habría aceptado.

**Antes de elegir se buscó una vía ya expuesta**: no hay vista sobre
`coi_ordenes`, no hay columna generada con el número normalizado, ninguna RPC
concedida a `authenticated` resuelve una orden por su número, y PostgREST no
permite filtrar por una expresión de función. `coi_normalize_order_number` estaba
revocada a `authenticated` en las dos migraciones que la definen, sin ningún
grant posterior.

Decisión: **conceder EXECUTE de esa misma función**, en lugar de reimplementar la
normalización en JavaScript —que sería exactamente el problema que el hallazgo
señala: dos definiciones que pueden separarse—.

Es seguro porque la función es `language sql`, `immutable`, `strict`, **no** es
`security definer` y no lee ninguna tabla: transforma texto y devuelve texto.
Conocer el resultado no revela ningún dato; para saber si la orden existe hace
falta el SELECT sobre `coi_ordenes`, que ya está gobernado por su propia RLS.
`anon` queda explícitamente revocado.

El flujo pasa a ser: normalizar contra la base → buscar por `nro_oc` igual al
canónico → aceptar solo si hay **exactamente una** orden. `coi_ordenes` almacena
el número ya normalizado (`coi_order_number_guard`), así que la igualdad es
exacta y `coi_ordenes_nro_oc_uq` garantiza la unicidad.

Se mantienen las reglas previas: una OC no modificada no se revalida, una OC
nueva o cambiada exige validación remota, un fallo remoto no guarda, y nunca se
crea una OC. Ver [[KI-016]].

## TD-033 — El catálogo local de OC es pista positiva, nunca autoridad negativa
Fecha: 2026-08-31.

[[TD-026]] pasó la decisión a Supabase, pero quedó una rama previa: si el
catálogo en memoria estaba poblado y no encontraba el texto, se rechazaba **antes
de consultar**. Eso bloqueaba una OC recién creada en otro puesto, y también una
variante como `OC 4530008964` que la normalización canónica acepta pero que ese
catálogo —que compara por texto— no reconoce.

Decisión: para crear un ST o cambiar su OC, **siempre** se resuelve contra
Supabase. El catálogo dejó de participar en la decisión, así que se retiraron
`filasOC()`, `resolverOC()` y `hayCatalogoOC()` en lugar de dejarlos sin uso: como
gate positivo tampoco servirían —dejarían pasar asociaciones a OC ya eliminadas—.

## TD-034 — La OC original de una edición es la renderizada
Fecha: 2026-08-31.

Mismo patrón que [[TD-020]] y el estado de [[TD-022]]: `ocOriginal` se tomaba del
runtime al guardar. Si el remoto renumeraba mientras el formulario estaba
enfocado, el código comparaba la OC de los inputs contra la nueva del runtime,
concluía que el operador había cambiado la OC, e intentaba validar el número
viejo — rechazando una edición de descripción perfectamente legítima.

Decisión: `stEditandoOCOriginal` se fija al pintar los inputs. Un refresco que no
repinta no lo mueve; uno que sí repinta lo actualiza a la OC nueva. Si no cambió,
`nro_oc` no viaja en el patch y la renumeración remota sobrevive.

## TD-035 — Paginar por keyset sobre el UUID
Fecha: 2026-08-31.

La lectura paginada usaba `range()` ordenando por `codigo_um` (UM) y `fecha`
(ST) — **ambas editables**. Una inserción o edición de otro administrador entre
dos páginas corre las filas y produce saltos o repeticiones, y el snapshot
incompleto se marcaba `sincronizado` igual: un resultado parcial presentado como
completo.

Decisión: keyset sobre `id`, la única columna inmutable. `ORDER BY id` y
`id > último` en cada tramo. La deduplicación se conserva como defensa, pero ya
no es de ella que depende recuperar una fila.

## TD-036 — La UI se autoriza con el rol confirmado, no con un email
Fecha: 2026-08-31.

PostgreSQL ya decide con `coi_current_role()` ([[TD-014]]), pero la UI seguía
derivando el permiso administrativo de helpers legacy con email fijo
(`admin@coiroca.com`). Las dos direcciones fallaban: un `administrador` real con
otro correo veía la interfaz deshabilitada aunque la base lo aceptaría, y esa
cuenta degradada a `consulta` veía los controles habilitados aunque la base la
rechazaría.

Decisión: dentro de H04/H05 la autoridad es `runtime.rol`, el mismo valor que
evalúan las policies. Los helpers legacy siguen existiendo para los módulos
viejos; esta capa no los consulta ni usa ningún email como criterio.

## TD-037 — La OC de un Servicio Técnico se referencia por UUID
Fecha: 2026-08-31.

La identidad maestra de una Orden de Compra en el repositorio es `coi_ordenes.id`.
`nro_oc` es un identificador de **negocio**, renumerable mediante
`coi_renumerar_oc`. Todas las tablas dependientes de OC referencian por
`orden_id` y llevan `nro_oc` denormalizado; `coi_servicios_tecnicos_um` era la
única excepción, y la propia migración `20260813033959` lo dice al excluirla de
su preflight «porque estructuralmente no posee orden_id».

La primera versión de `202608310004` colgaba la foreign key de `nro_oc` y
propagaba las renumeraciones con `ON UPDATE CASCADE`. Funcionaba, pero ataba la
identidad del vínculo a un texto que cambia.

Decisión: se agrega `orden_id uuid` nullable y la FK técnica pasa a ser
`orden_id → coi_ordenes(id) ON DELETE RESTRICT`. `nro_oc` sigue existiendo como
dato visible —es lo que el operador lee y escribe— pero deja de ser referencia.
Renumerar una OC no cambia su UUID, de modo que **ninguna renumeración puede
mover, romper ni reasignar la relación ST → OC**: eso pasa a ser estructural.

Consecuencias: sin cascada, el UPDATE que `coi_renumerar_oc` hace sobre los ST
recupera su recuento real, y su verificación post-sync sigue siendo la garantía
de que ningún ST queda con el número anterior. Ver [[KI-015]] y [[TD-032]].

## TD-038 — Qué campo manda cuando llegan los dos
Fecha: 2026-08-31.

Con `orden_id` y `nro_oc` conviviendo, el trigger necesita una regla de
precedencia. Las dos reglas ingenuas fallan: si el UUID ganara siempre, un
operador no podría mover el ST a otra OC escribiendo el número —el trigger le
devolvería el de la orden vieja—; si ganara siempre el número, un formulario
abierto antes de una renumeración podría des-renumerar el ST.

Decisión: manda el campo que **esta sentencia** trae o cambia. En INSERT, el
`orden_id` si viene; si no, el número. En UPDATE se compara contra `old`: si
cambió `orden_id`, manda el UUID; si solo cambió `nro_oc`, se resuelve por
`coi_normalize_order_number` y se completan los dos. Un número que ya no existe
—el de una OC renumerada— se rechaza fail-closed.

El frontend acompaña la regla: una OC nueva o cambiada envía los dos campos, una
OC sin tocar no envía ninguno —la referencia persistida ya es la correcta— y
quitarla envía los dos explícitamente en `null`.

## TD-039 — Un estado de UM desconocido se muestra en neutro
Fecha: 2026-08-31.

`estadoUM()` conserva el valor remoto que no reconoce, porque es dato del
servidor y no corresponde inventarle un estado. Pero `badgeUM()` caía en la clase
`activo` por defecto, con lo que un estado como «Mantenimiento» se veía verde:
la interfaz afirmaba que la unidad está operativa sin que nadie lo hubiera dicho.

Decisión: el semáforo cubre solo los tres estados canónicos —ACTIVA, FUERA DE
SERVICIO, BAJA— y cualquier otro valor usa la clase neutra `sindatos`, que el CSS
ya definía. El texto remoto se muestra tal cual; lo único neutro es el estilo.

## TD-040 — Cancelar un ST usa la versión que el operador vio
Fecha: 2026-08-31.

El CAS de la edición ya tomaba la versión del formulario ([[TD-023]]), pero
`cancelarST()` la leía del runtime al momento del click. Con la ficha sostenida
por un input enfocado, un refresco podía llevar el runtime a V2 mientras el botón
Cancelar seguía perteneciendo visualmente a la V1: la cancelación se aplicaba
sobre una versión que el operador nunca vio y pisaba el cambio ajeno.

Decisión: la fila renderiza `data-h05-st-version` con la `fecha_actualizacion`
que tenía al pintarse, y `cancelarST(uuid, versionRenderizada)` usa **esa**
versión como condición del UPDATE. Si el remoto avanzó, el UPDATE afecta 0 filas
y se reporta el conflicto sin cambiar nada.

## TD-041 — La versión de una fila la pone PostgreSQL
Fecha: 2026-09-02.

`fecha_actualizacion` de UM y ST hace dos trabajos: es la marca de auditoría y es
el token de concurrencia optimista ([[TD-016]], [[TD-020]]). La versión **nueva**
la escribía el navegador (`new Date().toISOString()`), con lo que las dos
funciones dependían de un reloj que el sistema no controla: congelado, dos
ediciones seguidas escriben la misma versión y el CAS deja de distinguir estados;
atrasado, la fila retrocede y un token viejo puede volver a matchear.

Decisión: un trigger `BEFORE UPDATE` fija
`greatest(clock_timestamp(), old.fecha_actualizacion + interval '1 microsecond')`.
`clock_timestamp()` y no `now()`, que es constante durante toda la transacción;
el `greatest` garantiza estrictamente creciente aunque el reloj del servidor
retroceda. El cliente conserva lo único que le corresponde: mandar en el `WHERE`
la versión que el operador **vio**. Ver [[KI-017]].

Efecto lateral buscado: las escrituras server-side —la sincronización de `nro_oc`
que hace `coi_renumerar_oc`— también hacen avanzar la versión, cosa que ningún
cliente podía hacer porque no participa de esa escritura.

## TD-042 — El ST lockea la OC bloqueando en el INSERT y con NOWAIT en el UPDATE
Fecha: 2026-09-02.

`coi_st_resolver_nro_oc()` corre `BEFORE`, lo que cierra la ventana entre validar
y escribir dentro de una sentencia, pero no serializa contra **otra**
transacción. El trigger toma entonces un ROW LOCK sobre la fila de `coi_ordenes`
antes de derivar `nro_oc`, en las dos rutas de resolución. El **modo** depende de
la operación, y esa diferencia es el núcleo de la decisión:

| Operación | Lock |
|---|---|
| `INSERT` | `select ... for update` (bloqueante) |
| `UPDATE` | `select ... for update nowait` |

**El INSERT lockea y espera.** T1 inserta un ST y el trigger lee el número viejo;
T2 renumera esa OC y sincroniza las dependientes, pero la fila de T1 **todavía no
existe** y su `UPDATE` no la alcanza; ambos commitean y queda `orden_id` correcto
con `nro_oc` viejo. Esperar es seguro acá porque, cuando el trigger pide el lock,
la fila ST aún no está insertada: la renumeración no puede estar esperándola.

**El UPDATE no puede esperar.** Al actualizar una fila existente PostgreSQL
bloquea el tuple objetivo (`GetTupleForTrigger`) **antes** de disparar el BEFORE
ROW UPDATE. Un `FOR UPDATE` bloqueante daría `fila ST → coi_ordenes` contra el
`coi_ordenes → fila ST` de `coi_renumerar_oc`: deadlock entre editar un ST y
renumerar su OC.

**Y tampoco alcanza con no lockear en el UPDATE.** Una versión anterior de esta
decisión sostuvo que bastaba el lock que el executor ya tiene sobre la fila ST,
porque el sync del RPC se bloquea en ella. Eso vale **solo si el ST ya pertenecía
a la orden que se renumera**. En una reasociación no:

> ST confirmado contra la OC A. T1 lo reasocia a B y queda lockeada la fila ST;
> el trigger lee B con su número viejo. T2 renumera B: para T2 ese ST todavía
> pertenece a A —el cambio de T1 no está confirmado—, así que su sincronización
> de B no alcanza esa fila, y commitea. T1 commitea con el `orden_id` de B y el
> `nro_oc` viejo de B.

Es el mismo defecto que en el `INSERT` y por la misma razón: durante la
reasociación la fila todavía no es visible para el RPC como parte de B.

**Por eso NOWAIT.** No espera nunca, de modo que no puede participar de un ciclo:
el deadlock queda descartado por construcción, no por un orden de adquisición que
haya que sostener a mano. Si la renumeración ya tiene el lock, el NOWAIT falla en
el acto y el UPDATE del ST aborta liberando la fila; si el UPDATE gana el lock,
la renumeración espera la OC, el ST se confirma y después el RPC lo deja con el
número nuevo; y si el UPDATE lo hace la propia `coi_renumerar_oc`, que ya posee
ese lock, volver a pedirlo desde la misma transacción no conflictúa.

**Fail-closed.** El conflicto no se oculta ni se reintenta desde el trigger: se
captura `lock_not_available` (SQLSTATE 55P03) y se levanta
`COI_ST_OC_CONCURRENCIA` con un hint para actualizar y reintentar. Continuar sin
lock sería volver al defecto original; reintentar dentro del trigger escondería
una renumeración en curso que el operador tiene que ver.

Costo conocido y aceptado: `FOR UPDATE` también conflictúa con el `FOR KEY SHARE`
de las verificaciones de FK, así que un alta concurrente de otro ST sobre la misma
orden puede hacer fallar una reasociación con `COI_ST_OC_CONCURRENCIA`. Es un
falso positivo, no un dato corrupto, y la ventana es la de una sentencia
autocommit de PostgREST.

En la ruta por número el lock se toma **por UUID**: primero se localiza la orden
por forma canónica, después se lockea por `id` y se relee su número. Si en el
medio se renumeró, el número que escribió el operador ya no la identifica y la
asociación se rechaza fail-closed. Ver [[TD-037]], [[TD-038]] y [[KI-015]].

Un borrado concurrente no necesita lock para evitar huérfanos: la FK
`orden_id → coi_ordenes(id)` se evalúa en la escritura y es `ON DELETE RESTRICT`.

Limitación conocida del control: PGlite es single-session, así que **ni la
carrera, ni un deadlock, ni el disparo efectivo del NOWAIT pueden ejecutarse** en
los tests. `tests/check_h04_st_oc_referencial.js` verifica sobre la definición
realmente desplegada que cada ruta pida el modo correcto en cada camino, que no
quede ningún `FOR UPDATE` bloqueante en la rama `UPDATE`, y que el conflicto sea
fail-closed con 55P03 y sin reintento. El caso C sí se ejecuta —volver a pedir el
lock desde la misma transacción no conflictúa—, porque es una sola sesión.

## TD-043 — Una caché local no puede sobrevivir a un fallo remoto como verdad operativa
Fecha: 2026-09-04. PR: H06 (`fix/h06-localstorage-non-authoritative`).

Contexto. Tres capas Supabase-first resolvían el fallo remoto de la misma
manera: Órdenes con `fallbackLocalStorageSiFallaSupabase()`, Finanzas con
`applyCacheState()` y Timeline en el `catch` de `loadEvents()`. Las tres
leían su caché de localStorage y la publicaban en la memoria operativa
—`estaciones[].obras/servicios`, `window.posicionesFinancieras`,
`window.coiTimelineEvents`—. El resultado era que cada corte de red convertía
localStorage en la autoridad, y que un operador podía ver las OC, las posiciones
o los mailings cacheados por otro en el mismo puesto.

Decisión. Lo único que puede sobrevivir a un fallo es el último snapshot que ESA
sesión confirmó contra Supabase, que vive en memoria y muere con la pestaña. Sin
lectura confirmada previa, la vista queda vacía con el error a la vista. Ninguna
de las tres capas vuelve a leer su caché como autoridad; `readSupabaseCache()`
se eliminó por quedar sin uso.

Es el mismo criterio que H03 y H05 ya aplicaban —conservar el último remoto
confirmado, nunca el legado—, generalizado a las capas que faltaban.

Alternativas descartadas. (a) Mostrar la caché marcada como «no confirmada»:
sigue siendo localStorage decidiendo qué ve el operador, y el matiz visual se
pierde en cuanto otra vista consume la global. (b) Vaciar siempre ante un fallo:
convierte un corte de red momentáneo en un falso cero y es peor que conservar lo
que el servidor sí llegó a decir.

Consecuencias. Un corte de red con la pestaña recién abierta muestra vacío y el
error, no datos viejos. Las cachés quedaron write-only (KI-021). La precondición
de arranque de `timeline_supabase_first.spec.js` dejó de poder apoyarse en la
caché y ahora espera la clave legada preparada, que es su precondición real.

## TD-044 — El cambio de identidad invalida antes de adoptar el UID nuevo
Fecha: 2026-09-04. PR: H06 (`fix/h06-localstorage-non-authoritative`).

Contexto. Órdenes y Finanzas solo reaccionaban a `SIGNED_OUT`. Un `SIGNED_IN`
con otro UID disparaba la recarga sin invalidar nada, de modo que si la lectura
del operador nuevo fallaba, la degradación publicaba el material del anterior.
Timeline era peor: declaraba `timelineAuthGeneration` y NUNCA lo incrementaba
—no tenía listener de `coi:supabase-auth`—, así que un cambio de operador
dejaba en pantalla los mailings del anterior hasta que algo más forzara una
relectura.

Decisión. Las tres capas comparan la identidad y, ante un cambio REAL, invalidan
el snapshot confirmado, las cachés sensibles y lo publicado en memoria ANTES de
adoptar el UID nuevo. Un `TOKEN_REFRESHED` del mismo UID no invalida nada. Es
exactamente el orden que H05 fijó en `invalidarContextoInventario()`.

La primera identidad de la pestaña NO es un cambio de identidad: en Timeline,
tratarla como tal borraba `coi_timeline_events_v1` antes de que la migración
legada de una sola vez llegara a Supabase. El guard de arranque es explícito.

Alternativas descartadas. Invalidar en cada evento de auth: convierte un refresh
de token en un falso cero, que es el error que H05 ya había pagado.

Consecuencias. Ningún operador hereda material operativo de otro en el mismo
puesto. Fijado por `H06-4` y `H06-4b`.

## TD-045 — H06 le quita autoridad al legado; no lo borra
Fecha: 2026-09-04. PR: H06 (`fix/h06-localstorage-non-authoritative`).

Contexto. El objetivo de H06 es que localStorage deje de ser autoridad
operacional, no que desaparezca. Borrar claves habría destruido material que
todavía no está en Supabase y que ninguna migración repone.

Decisión. Las claves legadas siguen existiendo físicamente y con su contenido
intacto. Lo que cambia es que ninguna ruta de lectura operativa las consume. No
se ejecuta `localStorage.clear()`, no se borra en masa y no se importa nada
automáticamente. localStorage se conserva plenamente para preferencias de
interfaz, filtros, estado de UI y caché no autoritativa: tema, sidebar y filtros
del dashboard siguen funcionando igual.

Consecuencias. Los GAPs que quedan abiertos —documentación V64 (KI-019),
observaciones sin marcador (KI-020) y cachés write-only (KI-021)— están
documentados en vez de resueltos a ciegas. H07 decide su destino.

## TD-046 — (SUPERADA por TD-049) La documentación de OC se identifica por orden_id
Fecha: 2026-09-04. PR: H07 (`fix/h07-final-localstorage-supabase-first`).

Contexto. `coi_documentos_oc` y `coi_servicios_tecnicos_um` guardan `nro_oc`
denormalizado porque hay flujos que llegan con el número antes que con la orden;
por eso H04 tuvo que construir trigger y row lock para que una renumeración no
dejara copias viejas (TD-042).

Decisión. `coi_documentacion_oc` guarda solo `orden_id`. Una referencia
documental se crea SIEMPRE desde la ficha de una OC ya resuelta, y el cliente
tiene el catálogo de órdenes en memoria: el número vigente se resuelve al
publicar. Guardar una copia solo agregaría un dato capaz de quedar viejo.

Alternativas descartadas. Replicar el aparato de trigger y lock de H04: es
complejidad que aquí no compra nada, porque no existe el flujo «llega el número
antes que la orden».

Consecuencias. Si el catálogo de órdenes termina de cargar después que la
documentación, el número queda vacío un instante; se resuelve con un remapeo
diferido acotado —mismo criterio que H03— que además cae con el snapshot al
cambiar de identidad, para que ningún timer republique lo del operador anterior.

## TD-047 — Una caché que nadie puede leer no se conserva «por si acaso»
Fecha: 2026-09-04. PR: H07 (`fix/h07-final-localstorage-supabase-first`).

Contexto. H06 dejó tres cachés write-only (KI-021) argumentando que alimentaban
el backup y el diagnóstico de soporte.

Decisión. Se retiran. Un backup o un diagnóstico no justifican mantener datos
operativos en reposo en el navegador: el backup del Timeline se serializa desde
el snapshot confirmado en memoria, y el diagnóstico informa el estado de la
sesión, no el contenido de una copia. Lo que no puede obtenerse de forma
autoritativa se informa como no disponible, no se recupera de una caché vieja.

La purga de la copia preexistente ocurre recién cuando Supabase confirmó la
lectura: es provablemente sin pérdida.

Consecuencias. La sincronización entre pestañas del Timeline se conserva con
`coi_timeline_sync_ping_v1`, que lleva marca de tiempo y contador y no puede
reconstruir ningún evento. Un backup tomado sin sesión ya no incluye órdenes ni
posiciones: refleja lo que la sesión pudo confirmar, que es lo honesto.

## TD-048 — El legado sale del modelo operativo hacia una cuarentena explícita
Fecha: 2026-09-04. PR: H07 (`fix/h07-final-localstorage-supabase-first`).

Contexto. H05 congeló el legado de UM/ST, H06 le quitó autoridad a las cachés y
KI-020 dejó abierto el último camino: sin marcador de corte, H03 publicaba las
observaciones legadas como modelo operativo. La decisión pendiente no era
técnica —qué hacer con esas filas— y por eso H06 no la tocó.

Decisión. Se separa mostrar de publicar. El material legado —observaciones sin
marcador y referencias documentales— deja de entrar al modelo operativo y pasa a
una cuarentena inspeccionable: se conserva intacto, se cuenta, se puede exportar
y se puede importar de forma explícita, idempotente y validada contra las OC
remotas. Nunca se importa solo y nunca se borra.

Esto NO debilita la protección de KI-007: mientras haya material sin importar,
las mutaciones siguen bloqueadas. Lo único que cambia es de dónde sale esa señal.

Alternativas descartadas. (a) Borrar el legado: destruye material que ninguna
migración repone. (b) Marcarlo como importado sin importarlo: miente sobre el
estado del sistema y deja las filas fuera de alcance. (c) Dejarlo publicado: es
exactamente lo que H07 viene a cerrar.

Consecuencias. Después de H07 ningún dato operacional se reconstruye desde
localStorage: ni en el arranque, ni ante un fallo de red, ni con el remoto
vacío, ni al cambiar de identidad, ni al refrescar el token. Lo que queda en
localStorage son preferencias, filtros, marcadores de migración, señales de
sincronización y material legado en cuarentena.

## TD-049 — H07 retira la documentación legada en vez de darle una tabla propia
Fecha: 2026-09-05. PR #61 (`fix/h07-final-localstorage-supabase-first`).

Contexto. El objetivo de H07 es que ningún dato operacional dependa de
localStorage. El módulo documental V64/V575 guardaba sus referencias —tipo,
número, repositorio, ruta, «Carpeta documental OneDrive», links externos— solo
en `coi_documentacion_oc` de localStorage (KI-019). El primer intento le dio
autoridad creando `public.coi_documentacion_oc`.

Decisión. Se retira ese intento. La baseline vigente dice que OneDrive y
`Agregar link documental` **no se reintroducen** en Ficha OC y que el camino
activo es Supabase Storage más las tablas documentales vigentes. Darle una tabla
a ese modelo era construir un segundo camino operativo documental compitiendo
con `public.coi_documentos_oc`: resolvía la dependencia de localStorage
creando un problema arquitectónico mayor.

H07 hace lo único que le corresponde: saca la clave legada del modelo
operacional. `documentacionOC` queda vacío y congelado, las acciones del editor
retirado quedan deshabilitadas con un mensaje operativo en vez de simular éxito,
los lectores legados dejan de sumarla a conteos y backup, y el material se
conserva intacto, contable y exportable, sin autoimportarse nunca.

Alternativas descartadas. (a) Mantener la tabla nueva: contradice AGENTS.md y
BASELINE_OPERATIVA. (b) Dejar el editor escribiendo en localStorage: es
exactamente lo que H07 viene a cerrar. (c) Borrar el material: destruye
referencias que ninguna migración repone.

Consecuencias. H07 no aporta ninguna migración. Si en el futuro el negocio
necesitara referencias documentales externas, la decisión previa es de producto
—reabrir o no lo que la baseline retiró— y recién después técnica.

## TD-050 — Un corte de legado se declara conciliando, no suponiendo
Fecha: 2026-09-05. PR #61 (`fix/h07-final-localstorage-supabase-first`).

Contexto. El marcador de corte de H03 se ponía con `if (filas.length)`: bastaba
una observación remota cualquiera para dar por migrado todo el legado local,
poner la cuarentena en cero y liberar el bloqueo de escritura. Las filas locales
sin conciliar desaparecían de la vista sin haber llegado nunca a Supabase.

Decisión. La cuarentena se calcula comparando **fila por fila** —OC más texto
normalizado, que son los campos presentes en las dos formas— contra el snapshot
remoto confirmado. El corte se da por cumplido solo si no queda ninguna
pendiente. Sin lectura confirmada, todo el legado cuenta como pendiente.

Y la cuarentena deja de ser un callejón sin salida: `conciliar()` relee y
libera solo si el remoto ya tiene todo, y `descartar({ confirmado: true })`
exporta y libera el bloqueo sin borrar nada.

Consecuencias. Un puesto con legado sin conciliar sigue bloqueado para escritura
—la protección de KI-007 intacta— pero ahora tiene un camino explícito y seguro
para salir. Fijado por `H07-7` a `H07-10`.

## TD-051 — Una señal de sincronización no puede devolver el eco
Fecha: 2026-09-05. PR #61 (`fix/h07-final-localstorage-supabase-first`).

Contexto. H07 reemplazó la caché de eventos del Timeline por una señal sin
contenido operativo (`coi_timeline_sync_ping_v1`) para conservar la
sincronización entre pestañas. Pero `applyTimelineEvents()` emitía la señal
siempre: un `storage` de otra pestaña disparaba `loadEvents()`, que emitía
otra señal, que la otra pestaña volvía a escuchar. Con dos pestañas abiertas eso
es un eco sin fin contra Supabase.

Decisión. La recarga lleva un origen. Cuando la provocó la señal de otra pestaña
se actualiza el Timeline pero **no** se vuelve a emitir. Un ping produce una
relectura, no una cadena.

Consecuencias. La sincronización entre pestañas se conserva y deja de generar
tráfico creciente. Fijado por `H07-6`.

Actualización (2026-09-05): el **mecanismo** de esta decisión quedó superado por
TD-052. El principio —un ping produce una relectura, no una cadena— sigue igual.

## TD-052 — El origen de una recarga viaja con la petición, no en una global
Fecha: 2026-09-05. PR #61 (`fix/h07-final-localstorage-supabase-first`).

Contexto. La primera implementación de TD-051 guardaba el origen en una única
variable de módulo (`timelineOrigenRecarga`) con semántica guardar/restaurar. Con
dos eventos `storage` solapados el restore es LIFO: el primero devuelve `local`
y el segundo vuelve a poner `storage`. La variable quedaba pegada en `storage`
para siempre y, a partir de ahí, **ninguna mutación local volvía a avisar a las
otras pestañas**. El eco estaba resuelto al precio de romper la sincronización.

Decisión. El origen deja de ser estado del módulo y pasa a ser un parámetro de
la petición: `loadEvents({ emitirSync:false })` desde el listener de `storage`,
`emitirSync` por defecto en los caminos locales, propagado hasta
`applyTimelineEvents()`. Cada lectura captura su propio objeto de estado, de modo
que una lectura posterior no puede alterar lo que otra ya decidió. Si una
relectura pedida por otra pestaña se engancha a una lectura en curso, esa lectura
se degrada a no emitir; nunca al revés.

Alternativas descartadas. Contadores de anidamiento y timestamps de supresión:
siguen siendo estado global y siguen teniendo ventanas de carrera.

Consecuencias. No queda ninguna global mutable que restaurar. Fijado por
`H07-20`, que solapa dos señales y después comprueba que una mutación local sí
vuelve a emitir exactamente una.

## TD-053 — El modelo se limpia antes del primer await, no después
Fecha: 2026-09-05. PR #61.

Contexto. El inicializador histórico publica en `window.observacionesOC` lo que
encuentra en la clave legada, y eso ocurre mucho antes de que la capa H03
empiece a leer Supabase. H03 lo retiraba, pero recién después de operaciones
asíncronas. En un puesto con red lenta —o colgada— quedaba una ventana en la que
paneles y KPIs seguían mostrando observaciones locales, que pueden ser incluso
de otro operador del mismo navegador, como si fueran dato operativo.

Decisión. Mientras la sesión no tenga una lectura remota confirmada, el modelo
publicado se retira **sincrónicamente**, antes del primer `await` de la carga.
No se toca `localStorage`: la materia prima sigue intacta y la cuarentena la lee
con su getter nativo. Tampoco se presenta el vacío como lectura remota:
`sincronizado` sigue en `false`.

Consecuencias. Un snapshot remoto legítimo ya confirmado no se destruye por una
recarga de la misma sesión: la retirada se saltea cuando hay snapshot. Fijado por
`H07-13` (con la lectura demorada) y `H07-14`.

## TD-054 — Una cuarentena que bloquea necesita una salida en la interfaz
Fecha: 2026-09-05. PR #61.

Contexto. TD-048 y TD-050 dejaron el material legado fuera del modelo y las
mutaciones bloqueadas hasta conciliarlo. Las operaciones para resolverlo
existían —`conciliar`, `exportarJSON`, `descartar`— pero solo eran alcanzables
desde consola. Un operador real veía la edición bloqueada y no tenía salida.

Decisión. Se monta una superficie mínima sobre el sector que ya existe —7.
Observaciones de la Ficha OC, exactamente donde el operador se topa con el
bloqueo— con tres acciones: conciliar, exportar y descartar. El núcleo son las
operaciones que ya estaban; no se creó una API paralela. El aviso solo aparece
cuando hay cuarentena pendiente y desaparece cuando se resuelve.

Descartar exige confirmación explícita del usuario, exporta antes y **no** borra
la clave legada ni la importa: solo registra que el operador decidió que deje de
bloquear. El texto de la UI lo dice con esas palabras.

Consecuencias. El bloqueo deja de ser un callejón sin salida. Fijado por
`H07-15`, `H07-16`, `H07-17` y `H07-18`, todos por interacción real con la UI.

## TD-055 — Una conciliación usa la misma semántica canónica que la normalización
Fecha: 2026-09-05. PR #61.

Contexto. La clave de conciliación del legado usaba alias propios. Le faltaban
`numeroOC` y `descripcion`, que `v65NormalizarObservacion()` sí acepta. Una fila
legada guardada con esa forma producía la clave vacía `|` y quedaba en cuarentena
para siempre, aunque la observación ya estuviera en Supabase.

Decisión. La conciliación extrae **exactamente** los mismos alias que la función
canónica, en su mismo orden. Se extraen sin llamarla porque esa función genera
ids y fechas y acá hace falta una lectura pura. No se mantienen dos
normalizadores incompatibles.

Consecuencias. Fijado por `H07-19`.

## TD-056 — Una alerta no puede pedir una acción retirada
Fecha: 2026-09-05. PR #61.

Contexto. Retirado el modelo documental por referencia externa (TD-049), las
capas V64 y V58 seguían emitiendo alertas que empujan al operador justo a lo que
AGENTS.md y BASELINE_OPERATIVA prohíben reintroducir: «Cargar link de carpeta
documental», «Agregar referencia documental», «Agregar link de
SharePoint/OneDrive/Drive». Además se calculan sobre un store que ahora está
siempre vacío, así que se disparaban para **todas** las OC.

Decisión. Se filtran esas alertas por su tipo, al final de la cadena de
`generarAlertasCOI()`. Solo esas. Las alertas documentales del camino vigente
—Supabase Storage + `public.coi_documentos_oc`, que en el Centro de Alertas
llegan por V58: «OC activa sin Acta de Inicio», «Falta expediente», «Falta última
acta», «Estado documental pendiente»— quedan intactas.

Alternativas descartadas. Borrar los emisores V64: viven dentro de IIFE y su
reescritura tocaría zonas ajenas al alcance de H07 sin ganar nada operativo.

Consecuencias. Fijado por `H07-21`, que además comprueba contra el generador sin
filtrar que las alertas retiradas realmente se emitían: el filtro no es vacío.

Alcance ampliado (2026-09-05). El «Diagnóstico avanzado V58.1» era una segunda
superficie del mismo problema y **sí** era accionable: su tabla mostraba
`Asociar carpeta OneDrive/SharePoint.` y cada fila lleva un botón que manda ese
texto a Observaciones. Se aplicó el mismo criterio, filtrando por el texto del
problema en `window.renderAdminDiagnostico` —el camino que usa el botón del
panel, porque el `diagnostico()` interno se invoca por referencia cerrada— y en
`window.ejecutarDiagnosticoSistema`. Ver KI-024 y `H07-24`.

## Formato nueva decisión
ID, fecha, contexto, decisión, alternativas, consecuencias, PR.
