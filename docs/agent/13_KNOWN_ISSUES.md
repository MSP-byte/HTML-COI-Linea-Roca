# 13 — KNOWN ISSUES

Documento vivo.

## KI-001 — Duplicación de lógica en index.html
Estado: deuda técnica permanente.
Riesgo: funciones/listeners/globals solapadas.
Mitigación: auditoría, búsqueda previa y tests funcionales.

## KI-002 — Timeline histórico multi-OC
Estado: en seguimiento.
Algunos eventos históricos pueden contener OCs concatenadas.
Regla: recuperar desde evidencia explícita, validar contra OCs reales y no inventar.

## KI-003 — Duplicados documentales históricos
Estado: en seguimiento.
Posibles importaciones/reindexaciones duplicadas.
No borrar sin autorización. Deduplicar lectura de forma segura.

## KI-004 — Playwright/python3 en Windows
Estado: entorno.
El alias python3 puede apuntar a Microsoft Store. No cambiar producción solo por este entorno.

## KI-005 — Tests estáticos insuficientes
Estado: lección incorporada.
Cambios funcionales importantes requieren Playwright real.

## KI-006 — Migracion H03 pendiente de aplicar en remoto
Estado: RESUELTO (2026-08-30). Mergeado por PR #58 y aplicado en STAGING y en
PRODUCCION. `coi_observaciones_oc.orden_id` quedo en ON DELETE RESTRICT en ambos
entornos y `coi_eliminar_orden_integral` comprueba la tabla. El snapshot
`tests/fixtures/production_schema_contract.json` ya declara RESTRICT y la entrada
se movio de `_divergencias_pendientes.fk` a `_divergencias_pendientes._resueltas`.
Texto original conservado abajo como historia.

### Texto original
PR #58 (rama fix/h03-observaciones-supabase-first).
supabase/migrations/202608300002_h03_observaciones_delete_guard.sql existe en el
repositorio pero NO fue aplicada a Produccion ni a Staging.
Mientras eso siga asi:
- en ambos entornos coi_observaciones_oc.orden_id conserva ON DELETE CASCADE;
- coi_eliminar_orden_integral no comprueba coi_observaciones_oc.
En consecuencia, borrar en remoto una OC cuya unica dependencia sean observaciones
todavia las destruye. La divergencia esta declarada en
tests/fixtures/production_schema_contract.json -> _divergencias_pendientes y la
reporta check_schema_reproducibility.js en cada corrida.
Al aplicarla: actualizar el snapshot productivo y borrar esa entrada.

## KI-007 — Observaciones legacy pendientes de importar
Estado: RESUELTO (2026-08-30). Se importaron las 4 observaciones canonicas a
PRODUCCION y el marcador de corte quedo establecido, de modo que la capa H03 ya
no bloquea crear, editar, resolver, reabrir ni las acciones del Centro de
Alertas. Texto original conservado abajo como historia.

### Texto original
Decision aprobada en PR #58.
Mientras un puesto muestre observaciones del legado local (origen legacy-readonly
con filas), la capa H03 bloquea crear, editar, resolver, reabrir y las acciones del
Centro de Alertas, para no poner el marcador de corte antes de haber importado esas
filas a Supabase. Se desbloquea solo cuando la importacion exista y el marcador
quede establecido. La importacion es trabajo posterior a H03.

## KI-008 — Migracion H05 pendiente de aplicar en remoto
Estado: abierto. Rama `fix/h05-unidades-mantenimiento-supabase-first`.
`supabase/migrations/202608300003_h05_um_delete_guard.sql` existe en el
repositorio pero NO fue aplicada a PRODUCCION ni a STAGING. Mientras eso siga
asi, en ambos entornos `coi_servicios_tecnicos_um.unidad_id` conserva
ON DELETE CASCADE: un DELETE privilegiado sobre una UM destruiria en silencio
todo su historial de Servicios Tecnicos.

Mitigacion vigente: ni UM ni ST tienen policy DELETE, y la UI no ofrece borrado
fisico (baja logica y cancelacion). La FK RESTRICT es defensa en profundidad
para caminos ajenos a RLS.

La divergencia esta declarada en
`tests/fixtures/production_schema_contract.json` → `_divergencias_pendientes.fk`
y la reporta `check_schema_reproducibility.js` en cada corrida.
Al aplicarla: actualizar el snapshot productivo y mover la entrada a
`_divergencias_pendientes._resueltas`.

## KI-009 — Inventario legado de UM/ST congelado, pendiente de destino final
Estado: abierto. Decision registrada en TD-009.
Las claves legadas de UM y ST (28 UM y 3 ST de demostracion, inconsistentes y no
operativas) NO se importan y NO se borran: quedan congeladas. Los lectores
operativos ven `[]` y las escrituras sobre esas claves se ignoran, de modo que el
contenido historico llega intacto a H06.

Consecuencias a tener presentes:
- un backup creado despues de H05 ya no captura esas claves con contenido;
- restaurar un backup no repone esas claves.
Ambas cosas son deliberadas: ese contenido dejo de ser dato operativo.
El acceso deliberado sigue disponible por `__COI_UM_H05_LEGACY_RAW__` y
`__COI_UM_H05_LEGACY_WRITE__`. H06 decide si se archiva o se elimina.

## KI-010 — Campos de UM del legado sin lugar en el esquema canonico
Estado: abierto (funcional, no bloqueante).
El formulario legado de UM tenia Criticidad, Ubicacion tecnica, OC actual y
Fotos. Ninguno existe en `coi_unidades_mantenimiento`. Para no perder datos en
silencio, H05 dejo de ofrecer esos campos en lugar de aceptarlos y descartarlos:
el filtro de Criticidad se oculta y la tabla muestra columnas reales
(ramal, sector, N° de serie, cantidad de ST).
La relacion con Ordenes se registra ahora en cada Servicio Tecnico (`nro_oc`),
validada contra el catalogo remoto.
Si el negocio necesita criticidad o fotos de UM, requiere migracion autorizada.

## KI-011 — Indice unico canonico de ST (H04) pendiente en remoto
Estado: abierto. Rama `fix/h05-unidades-mantenimiento-supabase-first`.
`supabase/migrations/202608310001_h04_st_unique_guard.sql` crea el UNIQUE INDEX
`coi_servicios_tecnicos_um_unidad_nro_st_uidx` sobre
(unidad_id, numero de ST canonico), pero NO fue aplicado a PRODUCCION ni a
STAGING. Mientras eso siga asi, la unica defensa contra dos Servicios Tecnicos
con el mismo numero en la misma UM es la comprobacion previa del frontend, que
es UX y no integridad: con dos operadores concurrentes ambos leen «no existe» y
despues insertan.

El numero canonico es `upper(regexp_replace(nro_st, '[[:space:]./-]+', '', 'g'))`,
la misma normalizacion que `claveST()` en index.html. Un unique literal habria
sido mas laxo que la propia UI, que ya considera el mismo ST a `ST-0001`,
`st0001` y `ST / 0001`.

Ambos entornos tienen hoy 0 ST, de modo que el riesgo real es nulo hasta que se
empiece a cargar. La migracion es segura igualmente: si encontrara equivalentes
canonicos preexistentes aborta con `COI_ST_DUPLICADOS_PREEXISTENTES` y no
modifica filas.

La divergencia esta declarada en
`tests/fixtures/production_schema_contract.json` → `_divergencias_pendientes.unique`
y la reporta `check_schema_reproducibility.js` en cada corrida.
Al aplicarla: agregar el indice al snapshot productivo de la tabla y mover la
entrada a `_divergencias_pendientes._resueltas`.

## KI-012 — Rol, RLS y grants de UM/ST (H04/H05) pendientes en remoto
Estado: abierto. Rama `fix/h05-unidades-mantenimiento-supabase-first`.
`supabase/migrations/202608310002_h04_h05_role_guard.sql` agrega policies
RESTRICTIVE que exigen `coi_current_role() = 'administrador'` para INSERT y
UPDATE sobre `coi_unidades_mantenimiento` y `coi_servicios_tecnicos_um`, exige
perfil activo para SELECT, y endurece los grants (anon sin nada; authenticated
con exactamente SELECT/INSERT/UPDATE). NO fue aplicada a PRODUCCION ni a
STAGING.

Mientras eso siga asi, las policies remotas solo exigen estar autenticado:
**un usuario con perfil `consulta` puede saltarse la UI y llamar a PostgREST
directamente para crear o modificar UM y ST**. La restriccion de la interfaz es
real para el operador, pero no es una defensa: vive en JavaScript.

Riesgo acotado hoy porque ambas tablas estan vacias en remoto, pero conviene
desplegarla antes de empezar a cargar inventario.

Las divergencias estan declaradas en
`tests/fixtures/production_schema_contract.json` →
`_divergencias_pendientes.policies` y `_divergencias_pendientes.grants`, y
`check_schema_reproducibility.js` verifica en cada corrida que el repositorio
efectivamente las produzca. `tests/check_h04_h05_role_guard.js` ejerce las
policies de verdad sobre PGlite, cambiando de rol y de identidad.
Al aplicarla: pasar las policies al snapshot productivo de cada tabla, ajustar
los grants y mover las entradas a `_divergencias_pendientes._resueltas`.

## KI-013 — Indice unico canonico de codigo_um (H05) pendiente en remoto
Estado: abierto. Rama `fix/h05-unidades-mantenimiento-supabase-first`.
`supabase/migrations/202608310003_h05_um_codigo_unique_guard.sql` crea el UNIQUE
INDEX `coi_unidades_mantenimiento_codigo_um_canonico_uidx` sobre la forma
canonica del codigo, pero NO fue aplicado a PRODUCCION ni a STAGING.

Mientras eso siga asi, la base es **mas permisiva que la propia interfaz**: solo
existe el UNIQUE literal y sensible a mayusculas del baseline, mientras el
frontend considera la misma UM a `ASC-001`, `asc001` y `ASC / 001`. Dos
operadores concurrentes pueden crear variantes que pasan el UNIQUE y que despues
la UI trata como una sola unidad, con el historial tecnico de una apareciendo
bajo la otra.

El UNIQUE literal del baseline NO se modifica: el indice se suma como defensa
adicional. La normalizacion es
`upper(regexp_replace(codigo_um, '[[:space:]./-]+', '', 'g'))`, la misma que
`claveUM()` en index.html.

Ambos entornos tienen hoy 0 UM, de modo que el riesgo real es nulo hasta que se
empiece a cargar. Si encontrara codigos equivalentes preexistentes, la migracion
aborta con `COI_UM_CODIGO_DUPLICADO_CANONICO` y no modifica filas.

Declarado en `tests/fixtures/production_schema_contract.json` →
`_divergencias_pendientes.unique`.

## KI-014 — Servicios Tecnicos sin Unidad de Mantenimiento resoluble
Estado: abierto (funcional, sin datos afectados hoy).
`coi_servicios_tecnicos_um.unidad_id` es nullable en el esquema productivo, y un
ST tambien puede apuntar a una UM que ya no este en el modelo remoto. Esas filas
se leen y se cuentan, pero ninguna ficha las muestra: toda la UI de ST se llega
por `stDeUM(uuid)`.

H05 los hace visibles en el panel «Servicios Tecnicos pendientes de asociacion»,
dentro del modulo de UM, con todos sus campos y su `unidad_id` sin resolver.
**No se inventa una UM, no se autoasigna y no se borra nada**: el panel solo da
visibilidad para que alguien pueda regularizarlos.

Falta definir el circuito de reasignacion. Hasta entonces, esas filas quedan a la
vista y fuera de cualquier ficha.

## KI-015 — Identidad tecnica ST → OC (H04) pendiente en remoto
Estado: abierto. Rama `fix/h05-unidades-mantenimiento-supabase-first`.
`supabase/migrations/202608310004_h04_st_oc_referencial.sql` agrega
`coi_servicios_tecnicos_um.orden_id uuid` (nullable) y hace que la relacion
tecnica sea `orden_id → coi_ordenes(id)` con `ON DELETE RESTRICT`, mas un
trigger `BEFORE` que mantiene coherentes `orden_id` y `nro_oc`. `nro_oc` queda
como dato visible denormalizado y **no** como referencia tecnica. NO fue
aplicada a PRODUCCION ni a STAGING.

Mientras eso siga asi, la asociacion sigue siendo texto libre validado por el
frontend: la validacion no respeta la normalizacion canonica de la misma forma
que la base, queda una ventana de carrera entre validar y escribir, y el vinculo
sigue colgando de un identificador de negocio renumerable.

Ambos entornos tienen hoy 0 ST, de modo que el riesgo real es nulo hasta que se
empiece a cargar. Si encontrara ST citando una OC inexistente, la migracion
aborta con `COI_ST_OC_HUERFANAS_PREEXISTENTES` y no vacia ni borra filas; las
que si resuelven reciben su `orden_id` por backfill.

**Efecto a tener presente al desplegar**: `coi_renumerar_oc` sigue siendo el
unico camino que cambia `coi_ordenes.nro_oc` —el RPC atomico de edicion de
ordenes no admite ese campo—. Actualiza primero `coi_ordenes` y despues las
tablas dependientes, de modo que su UPDATE sobre `coi_servicios_tecnicos_um`
llega cuando el trigger ya lee el numero nuevo, conserva su recuento real y su
verificacion post-sync sigue abortando la renumeracion entera si algun ST
quedara con el numero anterior. **La renumeracion no altera `orden_id`**: el
UUID no cambia, asi que el vinculo es estable por construccion.

El preflight del RPC excluye a `coi_servicios_tecnicos_um` porque la tabla no
tenia `orden_id`. Ese control busca filas que citen el numero anterior apuntando
a OTRO `orden_id`, y con el trigger esa combinacion es inalcanzable: `nro_oc` se
deriva siempre del `orden_id` de la propia fila. No se modifico el RPC.

Declarada en `tests/fixtures/production_schema_contract.json` →
`_divergencias_pendientes.columnas` (la columna `orden_id`) y
`_divergencias_pendientes.fk` como FK nueva (`produccion: "sin FK"`).

## KI-016 — Grant de coi_normalize_order_number pendiente en remoto
Estado: abierto. Rama `fix/h05-unidades-mantenimiento-supabase-first`.
`supabase/migrations/202608310005_h04_normalize_order_number_grant.sql` concede
EXECUTE de `public.coi_normalize_order_number(text)` al rol `authenticated`, para
que la prevalidacion del frontend use la MISMA identidad de OC que la base. NO
fue aplicada a PRODUCCION ni a STAGING.

Mientras eso siga asi, la llamada RPC de la capa fallara y —por diseño
fail-closed— **no se podra asociar ninguna OC nueva a un Servicio Tecnico**: la
UI dira «No se pudo verificar la OC» y no guardara. Editar cualquier otro campo
de un ST, o guardarlo sin OC, sigue funcionando; tambien sigue funcionando toda
la gestion de UM.

Es el comportamiento deliberado: preferimos no guardar una asociacion sin validar
antes que aceptarla a ciegas. Pero conviene desplegar esta migracion junto con
las demas del PR, no despues, para no dejar la carga de ST con OC bloqueada.

La migracion es un unico grant sobre una funcion pura —sql, immutable, strict,
sin security definer y sin acceso a tablas—; `anon` queda explicitamente
revocado. Declarada en `tests/fixtures/production_schema_contract.json` →
`_divergencias_pendientes.grants_funciones`.

## KI-017 — Version server-side de UM/ST pendiente en remoto
Estado: abierto. Rama `fix/h05-unidades-mantenimiento-supabase-first`.
`supabase/migrations/202609020001_h04_h05_server_version_guard.sql` instala un
trigger `BEFORE UPDATE` en `coi_unidades_mantenimiento` y en
`coi_servicios_tecnicos_um` que fija `fecha_actualizacion` en
`greatest(clock_timestamp(), old.fecha_actualizacion + interval '1 microsecond')`.
NO fue aplicada a PRODUCCION ni a STAGING.

`fecha_actualizacion` es a la vez marca de auditoria y token de concurrencia
optimista (CAS). Mientras la version NUEVA la escribia el navegador, las dos
funciones colgaban de un reloj que el sistema no controla: con el reloj congelado
dos ediciones consecutivas escriben la misma version y el token deja de
distinguir estados; con el reloj atrasado la fila retrocede y un CAS viejo puede
volver a matchear. Ademas ninguna escritura server-side —la sincronizacion de
`nro_oc` que hace `coi_renumerar_oc`— tenia quien le hiciera avanzar la version.

El frontend ya dejo de mandar la version nueva (`actualizarUM` y `actualizarST`
borran `fecha_actualizacion` del cuerpo del UPDATE). El token renderizado sigue
viajando en el `WHERE` como CAS, que es lo unico que le corresponde al cliente.
**Mientras la migracion no este aplicada, `fecha_actualizacion` no avanza en los
UPDATE del frontend**: el CAS seguiria matcheando el mismo valor y dejaria de
detectar la edicion concurrente. Por eso esta migracion es parte del mismo
despliegue que las demas y no puede quedar para despues (ver KI-018).

Es no destructiva: no borra, no vacia y no reescribe filas existentes. Las
versiones vigentes quedan como estan y avanzan recien en su proxima
modificacion. Reaplicarla es NO-OP.

Control: `tests/check_h04_h05_server_version_guard.js`.

## KI-018 — Orden de rollout de PR #59: el esquema va ANTES que el frontend
Estado: abierto. Rama `fix/h05-unidades-mantenimiento-supabase-first`.

El frontend de esta rama **selecciona `orden_id`** en
`coi_servicios_tecnicos_um` (`CAMPOS_ST`), y esa columna todavia NO existe en
PRODUCCION. Publicar el frontend antes que el esquema haria que toda lectura de
Servicios Tecnicos fallara. No se agrega compatibilidad dual, ni fallback a un
esquema sin `orden_id`, ni degradacion del UUID: la columna tiene que existir
antes, no despues.

Orden obligatorio:

1. **PR #59 SIN MERGE**;
2. aplicar las migraciones definitivas en **STAGING**;
3. **smoke en STAGING**;
4. aplicar las migraciones definitivas en **PRODUCCION**, con autorizacion
   explicita;
5. **verificar PRODUCCION**;
6. recien entonces **mergear PR #59**;
7. GitHub Pages publica desde `main`.

Migraciones del despliegue, en orden:

1. `202608300003_h05_um_delete_guard.sql`
2. `202608310001_h04_st_unique_guard.sql`
3. `202608310002_h04_h05_role_guard.sql`
4. `202608310003_h05_um_codigo_unique_guard.sql`
5. `202608310004_h04_st_oc_referencial.sql`
6. `202608310005_h04_normalize_order_number_grant.sql`
7. `202609020001_h04_h05_server_version_guard.sql`

Ninguna de las siete fue aplicada a STAGING ni a PRODUCCION al momento de
escribir esto. Este documento **no** declara ningun entorno remoto actualizado:
cuando se apliquen, hay que actualizar el snapshot productivo y mover las
divergencias correspondientes en
`tests/fixtures/production_schema_contract.json`.

## Actualización
Registrar PR, fecha, resolución y test de regresión.

## KI-019 — Documentación OC (V64) sigue siendo local-autoritativa
Estado: RESUELTO (2026-09-05) por H07, rama
`fix/h07-final-localstorage-supabase-first`, **por RETIRO del modelo legado**,
no por creación de una tabla nueva.

Un primer intento de H07 creó `public.coi_documentacion_oc` para darle
autoridad remota a las referencias externas de la V64/V575 —repositorio, ruta,
«Carpeta documental OneDrive», links—. El review del PR #61 lo marcó como P1 y
tenía razón: eso construía un SEGUNDO camino operativo documental, contra lo que
fija la baseline vigente:

- **AGENTS.md**: «No reintroducir OneDrive ni `Agregar link documental` en
  Ficha OC» y «Supabase Storage y las tablas documentales vigentes son el camino
  activo».
- **BASELINE_OPERATIVA.md** → Documentación: no reintroducir OneDrive en Ficha
  OC ni `Agregar link documental`.

La migración y esa capa fueron **retiradas del PR**. La resolución real es:

- el camino documental **activo** sigue siendo Supabase Storage (bucket
  `coi-documentos`) indexado en `public.coi_documentos_oc`, que no se tocó;
- `documentacionOC` queda **siempre vacío y congelado**: no se siembra desde
  localStorage y ninguna capa legada puede republicarlo;
- las acciones del editor documental retirado (alta, edición, baja, carpeta
  OneDrive, «Limpiar documentación global») quedan **deshabilitadas** con un
  mensaje operativo, en vez de «guardar OK» sin autoridad detrás;
- `v62DocsGlobales()` y los demás lectores legados dejan de sumar
  documentación local a conteos, diagnósticos y backup;
- el material histórico **se conserva intacto** en `coi_documentacion_oc` y
  `coiDocumentos`, contable y exportable por `__COI_DOC_H07_LEGACY__`, y
  **nunca se autoimporta**. No hay importación operativa porque no hay un modelo
  operativo al que importar.

Fijado por `tests/h07_cierre_localstorage.spec.js` y
`tests/check_h07_cierre_localstorage.js`.

Texto original conservado abajo como historia.

### Texto original

`coi_documentacion_oc` guarda las REFERENCIAS documentales de la V64 —tipo,
número, repositorio, ruta, link de OneDrive/SharePoint, estado documental— y es
la única fuente de esos datos: `documentacionOC` se siembra desde localStorage
al parsear el documento, se edita en memoria y se vuelve a escribir ahí mismo.
No hay tabla remota equivalente.

Es distinto de `public.coi_documentos_oc`, que sí existe y es Supabase-first:
esa indexa los PDF reales del bucket `coi-documentos`. Las referencias externas
de la V64 no tienen lugar en ese esquema.

Consecuencias mientras siga abierto:
- las referencias documentales NO se comparten entre usuarios ni entre equipos;
- se pierden al limpiar el navegador y no se reponen desde Supabase;
- un cambio de operador en el mismo puesto ve las referencias del anterior.

Resolverlo exige una tabla nueva, su migración, RLS y una capa CRUD: es
arquitectura nueva y quedó explícitamente fuera del alcance de H06. H07 decide
si se migra a Supabase o si se declara dato no operativo.

## KI-020 — H03 sin marcador de corte todavía muestra observaciones legadas
Estado: RESUELTO (2026-09-04) por H07, rama
`fix/h07-final-localstorage-supabase-first`.

El origen `legacy-readonly` desapareció: las observaciones legadas ya no se
publican como modelo operativo en ningún camino. Ahora quedan en CUARENTENA
(`__COI_OBS_H07_CUARENTENA__`), conservadas intactas, contabilizadas y
exportables, pero fuera de `window.observacionesOC`, sin alimentar KPIs y sin
poder sobrescribir filas de Supabase.

Tras el review del PR #61 se corrigieron dos defectos de esa primera versión:

1. **El corte se daba por cumplido con cualquier fila remota.** El marcador se
   ponía con `if (filas.length) ponerMarcador()`, de modo que una observación
   de Supabase sin relación con el legado local ponía la cuarentena en cero y
   liberaba el bloqueo de escritura. Ahora la conciliación es **determinista**:
   se compara fila por fila (OC + texto normalizado) contra el remoto
   confirmado, y el corte solo se cumple cuando **todas** las filas locales
   aparecen allá —o cuando el puesto nunca tuvo legado—. Sin lectura confirmada,
   todo el legado cuenta como pendiente (fail-closed).
2. **La cuarentena no tenía salida.** Se agregó un circuito explícito:
   `conciliar()` relee Supabase y libera solo si no falta ninguna fila, y
   `descartar({ confirmado: true })` exporta primero y libera el bloqueo
   **sin borrar** la clave.

Además, la clave legada quedó aislada de **todos** los lectores operativos: el
`getItem` público la enmascara siempre —antes solo con el marcador puesto, que
es justo cuando menos hacía falta—. La API de cuarentena la sigue viendo por el
getter nativo interno.

En la segunda vuelta de review del PR #61 se cerraron tres huecos más:

3. **La clave de conciliación no usaba los alias canónicos.** Le faltaban
   `numeroOC` y `descripcion`, que `v65NormalizarObservacion()` sí acepta: una
   fila legada con esa forma producía la clave vacía `|` y quedaba bloqueada
   para siempre. Ahora se extraen exactamente los mismos alias (TD-055).
4. **La salida existía pero solo desde consola.** Se agregó una superficie
   mínima en el sector 7. Observaciones de la Ficha OC —conciliar, exportar,
   descartar— sobre las mismas operaciones, sin API paralela (TD-054).
5. **El legado publicado sobrevivía a la espera de Supabase.** Con red lenta,
   los paneles seguían mostrando material local mientras la lectura remota no
   contestaba. Ahora se retira sincrónicamente, antes del primer `await`
   (TD-053).

La protección de KI-007 se mantiene: mientras exista material sin conciliar,
`cutoverPendiente()` bloquea toda mutación. Fijado por `H07-7` a `H07-10`,
`H07-13` a `H07-19` en `tests/h07_cierre_localstorage.spec.js` y por `H06-10c`.

Texto original conservado abajo como historia.

### Texto original

Con el marcador `coi_observaciones_h03_imported_v1` puesto —el estado de
PRODUCCIÓN desde que KI-007 quedó resuelto— H03 no vuelve a mirar la clave
legada nunca más, ni con el remoto vacío ni con el remoto caído. Eso está fijado
por `H06-10b` en `tests/h06_localstorage_non_authoritative.spec.js`.

En un puesto que NUNCA corrió la importación y todavía conserva observaciones en
`coi_observaciones_oc`, H03 sigue mostrándolas en modo `legacy-readonly` y
bloquea toda escritura mientras dure. Es la red de seguridad deliberada de
KI-007: no ocultar datos que aún no llegaron a Supabase.

Estrictamente, esa rama es la última en la que localStorage puede representar
datos operativos. H06 NO la tocó: retirarla exige decidir primero qué pasa con
esas filas —exportarlas, importarlas o descartarlas— y esa decisión no es
técnica. El comportamiento queda fijado y es rastreable en `H06-10c`.

## KI-021 — Cachés operativas de localStorage quedaron write-only
Estado: RESUELTO (2026-09-04) por H07, rama
`fix/h07-final-localstorage-supabase-first`.

Las tres dejaron de escribirse:

- `coi_supabase_ordenes_cache_v2` — `cacheSupabaseOrders()` se sustituyó por
  `purgarCacheOrdenesRetirada()`;
- `coi_cache_posiciones_oc_supabase_v1` — `saveRemoteCache()` solo descarta;
- `coi_timeline_events_v1` — `applyTimelineEvents()` ya no persiste eventos.

La copia vieja se descarta recién cuando Supabase confirmó la lectura, de modo
que la purga no puede perder nada. El Timeline conserva la sincronización entre
pestañas con `coi_timeline_sync_ping_v1`, una señal con marca de tiempo y un
contador: no contiene eventos y no puede reconstruir nada. El backup integral
sigue llevando el Timeline, pero serializado desde el snapshot confirmado en
memoria, no leyendo la caché. Fijado por `H07-11` y `H07-12`.

Texto original conservado abajo como historia.

### Texto original

`coi_supabase_ordenes_cache_v2`, `coi_cache_posiciones_oc_supabase_v1` y
`coi_timeline_events_v1` se siguen ESCRIBIENDO pero ya no se releen como
autoridad operativa. Se conservan porque alimentan el backup JSON integral y el
diagnóstico de soporte, y porque `purgarCachesOperativasSensibles()` y el
cambio de identidad las borran.

Queda pendiente decidir si aportan lo suficiente como para justificar mantener
datos operativos en reposo en el navegador. H07 puede retirarlas.

## KI-022 — Migración H07 de documentación pendiente de aplicar en remoto
Estado: **SIN EFECTO / RETIRADO (2026-09-05).** La migración que motivaba esta
entrada fue eliminada del PR #61 junto con el modelo documental que creaba (ver
KI-019). H07 **no aporta ninguna migración**: no hay rollout pendiente por H07.
La entrada se conserva como historia de la decisión.

Texto original:

`supabase/migrations/202609040001_h07_documentacion_oc.sql` existe en el
repositorio pero NO fue aplicada a PRODUCCIÓN ni a STAGING. Mientras eso siga
así, `public.coi_documentacion_oc` no existe y el módulo documental informa
que la tabla no está disponible: no muestra referencias y no acepta altas.

Es un estado degradado DELIBERADO y visible: el módulo no vuelve a localStorage
en ningún caso. La divergencia está declarada en
`tests/fixtures/production_schema_contract.json` →
`_divergencias_pendientes.tablas`.

Al aplicarla: actualizar el snapshot productivo y mover la entrada a
`_divergencias_pendientes._resueltas`. Recién entonces conviene decidir qué se
hace con el material documental que quede en cuarentena en cada puesto
(`__COI_DOC_H07_LEGACY__.importar({ confirmado: true })`).

## KI-023 — Escritores legados en la fuente, neutralizados en runtime
Estado: abierto (deuda menor, sin impacto operativo conocido).

`v65GuardarObservacionesOC` y otros escritores históricos de
`coi_observaciones_oc` siguen existiendo en el código fuente de `index.html`,
pero H03 los sustituye en `instalar()` por versiones que no persisten nada.
H07 hizo lo mismo con `v64GuardarDocumentacionOC`, que además quedó neutralizado
EN LA FUENTE y ya no escribe la clave documental.

La deuda es que la garantía depende de que el override esté instalado. Las
suites H03 y H07 lo verifican funcionalmente, pero convendría eliminar los
cuerpos legados cuando se pueda tocar esa zona sin riesgo.


## KI-024 — El Diagnóstico avanzado V58.1 pedía «Asociar carpeta OneDrive/SharePoint»
Estado: **RESUELTO (2026-09-05)** por H07, PR #61.

Al retirar el modelo documental por referencia externa quedó una segunda
superficie además del Centro de Alertas: la tabla del «Diagnóstico avanzado
V58.1» mostraba el problema `OC activa sin carpeta documental/link asociado.`
con la acción sugerida `Asociar carpeta OneDrive/SharePoint.`, y cada fila trae
un botón **Enviar a Observaciones** que lleva ese texto completo en su payload.

No era código muerto: cualquier administrador podía convertirlo en una
observación real de la OC pidiendo una acción explícitamente retirada por
AGENTS.md.

Corrección mínima: el problema se filtra por su texto —no por su tipo— en
`window.ejecutarDiagnosticoSistema` y, sobre todo, en
`window.renderAdminDiagnostico`, que es el camino que usa el botón del panel
(el `diagnostico()` interno se invoca por su referencia cerrada dentro de la
IIFE, así que envolver solo el global no alcanzaba). El contador
`problemasDocumentales` se recalcula. No se refactorizó la IIFE, no se
reintrodujo OneDrive y no se tocó Supabase Storage.

El otro problema documental, `Documento con fecha inválida.`, pertenece al
camino vigente y se conserva. Fijado por `H07-24`, que comprueba el HTML
renderizado y el payload del botón, y contrasta contra el generador sin filtrar
para que el filtro no sea vacío.

Queda como acceso programático sin superficie de UI `window.COI_V581.diagnostico`,
que sigue devolviendo el resumen crudo.

## KI-025 — (DESCARTADO) `getDocs()` no lee las claves documentales legadas
Estado: **SIN EFECTO (2026-09-05).** Se abrió por una lectura apresurada del
código y se verificó que era incorrecta. Se conserva la entrada para que nadie
vuelva a abrirla por el mismo motivo.

`getDocs()` del bloque V58.1 empieza por `if (typeof v62DocsGlobales === 'function')
return v62DocsGlobales();`. Ese lector siempre existe —es una declaración de
función global— y H07 lo sustituye por uno que devuelve `[]`. La rama que
recorre `coi_documentacion_oc`, `coiDocumentos`, `documentacionOC` y
`coi_documentos_oc` de localStorage es, por lo tanto, **inalcanzable**.

Consecuencias verificadas por `H07-25`:

- `resumen.totalDocumentos` del backup es `0`;
- `datos.documentosOC` va vacío y no se mezcla con `coi_documentos_oc`;
- el diagnóstico no genera problemas documentales del store retirado;
- el legado no alimenta ningún KPI.

El material legado solo aparece en `payload.localStorage`, que es el volcado
crudo del navegador —una sección de recuperación, no documentación operativa—.
`importarBackup()` restaura de ahí **únicamente** el Timeline, y por la ruta
autoritativa de Supabase (`COI_TIMELINE_COI.replace`); el resto de las claves no
se reescribe y el resumen informa qué datasets no se aplicaron localmente.
