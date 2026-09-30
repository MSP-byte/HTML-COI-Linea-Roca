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

## KI-008 — FK H05 de UM/ST
Estado: **RESUELTO (verificado live 2026-09-29).**

STAGING y PRODUCCIÓN exponen `coi_servicios_tecnicos_um.unidad_id → coi_unidades_mantenimiento(id)` con `ON DELETE RESTRICT`. La migración `202608300003_h05_um_delete_guard.sql` ya no es una divergencia pendiente. El contrato productivo fue reconciliado en PR #111.

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

## KI-011 — Índice único canónico de ST (H04)
Estado: **RESUELTO (verificado live 2026-09-29).**

El índice `coi_servicios_tecnicos_um_unidad_nro_st_uidx` está presente en STAGING y PRODUCCIÓN como UNIQUE canónico y parcial. No debe volver a planificarse como rollout pendiente.

## KI-012 — Rol, RLS y grants de UM/ST (H04/H05)
Estado: **RESUELTO (verificado live 2026-09-29).**

Ambos ambientes tienen las seis policies RESTRICTIVE esperadas para UM/ST. `anon` no conserva grants de tabla y `authenticated` queda limitado a SELECT/INSERT/UPDATE. El snapshot productivo de PR #111 refleja las policies desplegadas.

## KI-013 — Índice único canónico de codigo_um (H05)
Estado: **RESUELTO (verificado live 2026-09-29).**

El índice `coi_unidades_mantenimiento_codigo_um_canonico_uidx` está presente en STAGING y PRODUCCIÓN como UNIQUE canónico y parcial, coexistiendo con el UNIQUE literal del baseline.

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

## KI-015 — Identidad técnica ST → OC (H04)
Estado: **RESUELTO (verificado live 2026-09-29).**

`coi_servicios_tecnicos_um.orden_id uuid` existe en ambos ambientes, con FK a `coi_ordenes(id) ON DELETE RESTRICT`. También está presente el trigger `coi_st_resolver_nro_oc`; `nro_oc` queda como dato visible denormalizado y `orden_id` como identidad técnica.

## KI-016 — Grant de coi_normalize_order_number
Estado: **RESUELTO (verificado live 2026-09-29).**

En STAGING y PRODUCCIÓN, `authenticated` tiene EXECUTE sobre `coi_normalize_order_number(text)` y `anon` no lo tiene. La prevalidación del frontend puede usar la identidad canónica del servidor.

## KI-017 — Versión server-side de UM/ST
Estado: **RESUELTO (verificado live 2026-09-29).**

Los triggers `coi_um_version_servidor` y `coi_st_version_servidor` están presentes en STAGING y PRODUCCIÓN y ejecutan `coi_version_servidor()` antes de UPDATE.

## KI-018 — Orden de rollout de PR #59
Estado: **RESUELTO / HISTÓRICO (verificado live 2026-09-29).**

El riesgo de publicar frontend que selecciona `orden_id` antes del esquema ya no existe: columna, FK, trigger, índices, policies, grants y versionado server-side del paquete H04/H05 están presentes en STAGING y PRODUCCIÓN. Conservar esta entrada sólo como antecedente de por qué el esquema debía desplegarse antes del frontend.

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

Tercera vuelta de review: la conciliación comparaba contra un **conjunto** y
perdía la multiplicidad. Dos observaciones legadas idénticas quedaban las dos
conciliadas por una única fila remota equivalente, el marcador se ponía y la
segunda desaparecía de la recuperación sin haber llegado nunca a Supabase. Ahora
la comparación es de multiset: cada fila remota concilia exactamente una fila
local (TD-057).

Cuarta vuelta: el marcador de corte era un `'1'` pelado y, una vez puesto, daba
la cuarentena por resuelta **para siempre**. Ahora guarda la huella del contenido
conciliado y caduca si la clave legada cambia (TD-060). Un marcador histórico
`'1'` se migra adoptando el contenido actual, de modo que los puestos que ya
tenían el corte hecho no ven la cuarentena reabierta de golpe.

La protección de KI-007 se mantiene: mientras exista material sin conciliar,
`cutoverPendiente()` bloquea toda mutación. Fijado por `H07-7` a `H07-10`,
`H07-13` a `H07-19`, `H07-26` a `H07-28` y `H07-35`/`H07-36` en
`tests/h07_cierre_localstorage.spec.js`, y por `H06-10c`.

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

Tercera vuelta de review: quedaban dos escritores residuales en los caminos de
**borrado**, que leían la caché retirada, filtraban la fila eliminada y la
volvían a guardar. Con el DELETE remoto exitoso y la relectura fallida, la clave
quedaba reescrita con los datos operativos restantes. Ahora esas claves solo se
descartan (TD-058): cero escritores hacia
`coi_cache_posiciones_oc_supabase_v1` y hacia `coi_supabase_ordenes_cache_v2`.
`coi_supabase_estaciones_cache_v1` no está retirada y se conserva consistente.
Fijado por `H07-29`.

Además, el backup maestro tomaba el Timeline solo del volcado crudo de
localStorage: retirada esa clave, los backups posteriores a H07 salían **sin
Timeline**. Ahora se exporta en una sección autoritativa propia y se restaura por
la ruta remota canónica (TD-059). Fijado por `H07-30` a `H07-33`.

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

## KI-026 — No existe una exportación canónica de la documentación Storage
Estado: abierto (mejora, sin impacto operativo).

Los exports documentales por OC del modelo retirado
(`[data-v64-doc-export]`, `[data-v572-doc-export-filtered]`) quedaron **retirados**
en el PR #61: exportaban CSV desde `v64DocsOC`/`documentacionOC`, siempre vacíos
desde el retiro, y entregaban un archivo que parecía decir que la OC no tenía
documentación (TD-066).

No hay pérdida operativa —lo retirado exportaba cero filas—, pero tampoco existe
hoy una exportación de la documentación **vigente**, la de
`public.coi_documentos_oc` + Supabase Storage. El material ya está en memoria:
`window.cargarDocumentosStorageOC(orden)` devuelve las filas por OC.

Al retomarlo: construir la exportación sobre ese helper, no sobre el modelo
retirado, y dejar explícito en el nombre del archivo y en la cabecera que la
fuente es Supabase Storage.

## KI-027 — El backup integral todavía sugiere una estructura OneDrive
Estado: abierto (deuda menor, fuera del alcance de H07).

`obtenerBackupCompletoCOI()` sigue agregando
`payload.datos.estructuraOneDriveSugerida = DOC_ESTRUCTURA_ONEDRIVE_V575`, una
plantilla de carpetas del modelo por referencia externa retirado.

No es dato operativo, no alimenta KPIs, no entra en el restore y no aparece en
ninguna superficie de la Ficha OC —la del PR #61 quedó retirada por TD-065—. Es
un residuo informativo dentro de un archivo de backup.

Se deja anotado para que no se confunda con un camino documental vigente. Al
retomarlo, la corrección es quitar ese campo del payload.

## KI-028 — «UM vinculada» del listado de Órdenes no es el inventario
Estado: abierto (deuda menor, sin impacto operativo).

La columna y el filtro **UM vinculada** del módulo Órdenes salen de
`item.umVinculada || item.unidadMantenimiento || item.umClave || especialidad`:
es un texto de la propia OC, no una referencia al inventario
`coi_unidades_mantenimiento`. Dos cosas distintas con el mismo nombre.

H09 **no la tocó**, deliberadamente: está poblada —cae en `especialidad` cuando
no hay otra cosa—, de modo que no es ruido visual vacío, y quitarla o cambiarle
el sentido sería una decisión de producto, no del cierre de H09. Lo que sí
cambió es el eje del módulo UM: la OC pasó a ser una referencia opcional
(TD-068), así que esa columna ya no puede confundirse con el eje del inventario.

Al retomarlo: decidir si se renombra a «Especialidad / tipo de trabajo», que es
lo que realmente muestra, o si se la vincula de verdad contra el inventario.

## KI-029 — El inventario de UM sigue sin datos en producción
Estado: abierto (dato, no defecto).

`coi_unidades_mantenimiento` y `coi_servicios_tecnicos_um` tienen **0 filas** en
PRODUCCIÓN y en STAGING. H05 retiró deliberadamente el autoimport de las 28 UM y
3 ST de demostración que quedaron en `localStorage`, y H09 mantiene esa
decisión: el módulo muestra el estado vacío explícito
—«No hay Unidades de Mantenimiento cargadas en Supabase.»— y ofrece el alta.

El material legado se conserva físicamente en `localStorage` para una eventual
recuperación manual: no se importa, no se muestra como operativo y no se borra.

La carga inicial del inventario real de la red es trabajo operativo, no técnico.

## KI-030 — El cierre operativo no valida saldo ni actividad pendiente
Estado: abierto (límite del modelo, no defecto).

La definición funcional dice que se cierra una OC cuando está finalizada o
vencida, sin saldo operativo pendiente y sin certificaciones o actividades
pendientes. El modelo remoto solo permite verificar dos de esos tres puntos con
una fuente canónica confiable: `fecha_vencimiento` y `proxima_certificacion`.

«Saldo operativo pendiente» no tiene una fuente segura: `saldo_remanente` es el
saldo remanente **certificable**, que es otra cosa, y usarlo como gate sería
inventar una regla. «Actividad pendiente» no está modelada en ninguna columna.

Decisión deliberada: H10 **no bloquea** el cierre. La confirmación informa el
vencimiento y avisa explícitamente cuando figura una certificación pendiente
con su fecha, y decide el operador. Bloquear por datos que el modelo no
contempla produciría falsos negativos sobre OCs que legítimamente hay que
cerrar.

Cerrar lo que corresponda es, hoy, criterio operativo. Si en algún momento el
modelo incorpora una noción canónica de actividad pendiente, la validación puede
endurecerse sin tocar el camino de escritura.

## KI-031 — `ocActualId` es un binding léxico, no una propiedad de window
Estado: abierto (deuda estructural acotada).

`index.html` declara `let ocActualId = null;` en el script principal. Un `let` de
nivel superior crea un binding léxico global que **no** es una propiedad de
`window`, de modo que `window.ocActualId` queda vacío en la aplicación real
—salvo por una asignación aislada que lo deja en `''`—.

Cualquier capa que resuelva «la OC que está abierta» leyendo
`window.ocActualId` obtiene cadena vacía y no resuelve nada. H10 lo detectó al
ver que el rótulo «Desarchivar OC» de H09 no aparecía nunca fuera de las
pruebas, donde el fixture asigna `window.ocActualId` explícitamente.

Mitigación aplicada: H09 y H10 resuelven la referencia con el mismo helper
—binding léxico primero, después `window.ocActualId`, después el `data-oc` que
la propia ficha publica en su subnav—.

Queda abierto: unificar la variable en un único accesor, en vez de repetir el
helper en cada capa nueva. No se hizo en H10 para no ampliar el alcance.

## KI-032 — La Ficha OC no tiene una subpestaña «historial»
Estado: abierto (dato, no defecto).

Las rutas de H10 cubren las siete subpestañas que la ficha realmente tiene:
resumen, contractual, certificaciones, financiero, documentos, fotos y
observaciones. `#ficha-oc/<nro>/historial` no existe porque el panel no existe:
el historial de cambios de la OC se renderiza dentro de otra sección, no como
submódulo propio.

Una ruta desconocida en esa posición cae en `resumen` en vez de fallar, que es
el comportamiento deseado para un enlace viejo o mal tipeado.

## KI-033 — `renderChecksDocumentales` ya no es un punto de montaje de la Ficha
Estado: abierto (deuda estructural acotada).

`index.html` declara cuatro veces `function renderFichaOC(...)` y dos veces
`function renderChecksDocumentales(...)`. En un script clásico gana la última
declaración, y después se encadenan envoltorios (`V54`, `V57`…`V63`). La
`renderFichaOC` vigente arma las tarjetas 1 a 8 por su cuenta y **no** llama a
`renderChecksDocumentales`: esa función quedó viva como API, pero fuera del
camino de render de la Ficha.

E1 se apoyó en ella para montarse y por eso la pestaña Contractual quedó sin
circuito (ver TD-073). El arreglo no revive ese punto de montaje: inyecta el
bloque en el panel Contractual desde `injectCT`.

Queda abierto: consolidar las declaraciones duplicadas de `renderFichaOC` y
`renderChecksDocumentales`. No se hizo acá para no ampliar el alcance de un fix
de integración, pero mientras convivan, envolver una función homónima **no** es
evidencia de que la Ficha la ejecute. Verificar el DOM, no el símbolo.

## KI-034 — modalidad_certificacion
Estado: **RESUELTO en infraestructura (2026-09-29).**

El paquete completo `202609170003_modalidad_certificacion.sql`, `202609170004_modalidad_certificacion_writers.sql` y `202609190001_modalidad_certificacion_alta.sql` fue aplicado primero en STAGING y luego en PRODUCCIÓN.

El contrato live contiene `coi_ordenes.modalidad_certificacion` con default `SIN_DEFINIR`, dominio cerrado, índice parcial para `MENSUAL` y writers canónicos de alta/actualización. Las 34 OC históricas quedaron en `SIN_DEFINIR`; no se infirió `MENSUAL` ni `A_DEMANDA`. Para que un Servicio proyecte certificación automática, su modalidad debe definirse explícitamente como `MENSUAL`.

Ver TD-075 y el contrato productivo reconciliado en PR #111.

## KI-035 — La subpestaña Certificaciones ya no lista próximas certificaciones
Estado: abierto (cambio deliberado, documentado).

`Tabla Certificaciones` pasó a ser el historial de certificaciones **reales**
(ver `TD-074`). La tabla de *próximas* certificaciones que ocupaba ese panel se
retiró de ahí: las proyecciones siguen visibles como eventos del Calendario en
Vista COI I y Vista COI II, y la vista `vistaCalendarioCertificaciones` sigue
existiendo como módulo aparte.

Si hiciera falta una tabla tabular de próximas certificaciones dentro del
Calendario COI, conviene agregarla como subpestaña propia en vez de volver a
mezclar proyecciones con hechos en el mismo panel.

## KI-036 — Reconfirmar un hito vaciaba el Seguimiento Contractual
Estado: RESUELTO (rama `fix/contractual-10-milestones-state-machine`).

Síntoma (OC 4530009514): tras reconfirmar OBRA/SERVICIO FINALIZADA la Ficha
mostraba «Última actualización —», «Días en estado —», «1/8» y todas las
tarjetas «Sin confirmación registrada». Un F5 lo corregía.

Causa raíz: el pipeline resolvía la OC con `window.resolverOrdenActual`, que en
producción **no está exportado** (vive dentro del IIFE r12). `ordenDe()` daba
`null`, `reconciliarOrden(null, …)` fabricaba un `{}` con cuatro campos de
estado y sin `nro_oc`, y `repintar()` pintaba con ese objeto: historial leído con
clave vacía. Además, sin OC el modal proponía **hoy** como fecha por defecto, de
modo que una reconfirmación otro día sobrescribía la fecha efectiva del hito
vigente. Los tests previos no lo detectaban porque todos mockeaban
`resolverOrdenActual`, `__COI_CIRCUITO_CACHE_GET__` y `cargarHistorialCircuitoOC`.

Corrección: resolver canónico exacto `resolverOrdenCircuito` exportado y usado
por writer, lectura y pipeline; una sola caché en memoria; la reconciliación
nunca fabrica objetos. Fijado por `tests/contractual_10_hitos.spec.js`, que
corre el camino real con un port 1:1 de la RPC v3.

## KI-037 — «Alerta revisada» vive sólo en sessionStorage
Estado: abierto (detectado en el handoff del 2026-09-27; no se modificó código).

`setAlertaRevisada()` / `getAlertasRevisadas()` guardan la revisión en
`sessionStorage['coi_alertas_revisadas_v46']`: es por pestaña, se pierde al
cerrarla y no se comparte entre usuarios ni dispositivos. Sin embargo, H11
(`202609100001_h11_online_only_review_hardening.sql`) creó
`public.coi_alertas_revisadas` y las RPC `coi_marcar_alerta_revisada(text)` y
`coi_listar_alertas_revisadas()`, declaradas **presentes en producción** en
`production_schema_contract.json › objetos_h11`. El front no las invoca
(0 referencias en `index.html`).

Impacto: un dato de trabajo del operador no tiene autoridad remota.
Propuesta: cablear lectura/escritura a las RPC existentes, con Playwright
(mock) y sin tocar schema. Riesgo bajo-medio (Centro de Alertas tiene varias
capas de render).

## KI-038 — Las fotos de OC y estación no se persisten en Supabase
Estado: abierto (detectado en el handoff del 2026-09-27).

`guardarFotoOC()` y el equivalente de estación guardan dataURL en
`sessionStorage` (`coi_linea_roca_fotos_oc_v20`,
`coi_linea_roca_fotos_estacion_v19`). No existe tabla, bucket ni RPC de fotos
y el front no hace ningún `storage.upload`. Tras H11 las fotos duran lo que
dura la pestaña.

Propuesta: decidir funcionalmente si Fotos sigue siendo un módulo activo. Si
sí, requiere diseño Supabase (bucket + tabla índice + RLS) con migración
autorizada; si no, retirarlo de la Ficha como se hizo con OneDrive.

## KI-039 — `check_modalidad_certificacion.js` falla en Windows con CRLF
Estado: abierto (entorno, no defecto de producto).

Con `core.autocrlf=true` las migraciones se materializan con CRLF y el test
busca el literal `'control_terceros_estado'\n  ];`. Falla con «el resto de la
allowlist tiene que quedar igual que la vigente». En CI (Ubuntu, LF) pasa.
Verificado el 2026-09-27: mismo commit `d3344c7` en un worktree con
`core.autocrlf=false` → 45/45 controles aprobados y `npm test` completo exit 0.

Mitigación local: `git config core.autocrlf input` y re-checkout, o un
worktree con `-c core.autocrlf=false`. Mejora posible: normalizar `\r\n` en el
test (o agregar `.gitattributes` con `*.sql text eol=lf`), en PR propio.

## KI-040 — PR #85: hitos contractuales sobre OCs cerradas, migración fuera de main
Estado: abierto (decisión del owner pendiente).

La rama `fix/contractual-closed-oc-h10` (PR #85, abierto) agrega
`supabase/migrations/202609210001_etapa1_closed_oc_compat.sql`, que redefine
`coi_confirmar_etapa_circuito` (v1) para escribir `estado_documental` e
historial en OCs ya `Cerrada` sin tocar los campos que H10 hace inmutables.
Esa migración **no está en main**, y el front actual invoca la **v3**
(`coi_confirmar_etapa_circuito_v3`), así que el PR así como está no cubre el
camino vigente.

Pendiente: verificar en STAGING si confirmar un hito sobre una OC cerrada
falla contra los guards H10 y si la migración se aplicó a mano en algún
entorno. No mergear ni aplicar sin esa verificación y autorización.

## KI-041 — PRs y ramas remotas huérfanas
Estado: abierto (higiene del repositorio).

Al 2026-09-27 hay 12 PRs abiertos y ≈110 ramas remotas. El detalle con
evidencia está en `JULES_HANDOFF.md §30`. Resumen: #106 y #89 están superados
por #107 y #97; #88 por la línea #91/#94/#98; #3–#41 están 590–1160 commits
detrás de main. `fix/prox-cert-cerrada-persistida` quedó superada por #83. No
se cerró ni borró nada: requiere confirmación del owner.


## Reconciliación Supabase live — 2026-09-29

La auditoría directa de STAGING y PRODUCCIÓN corrigió supuestos del snapshot histórico:

- **KI-034 — RESUELTO en infraestructura:** `coi_ordenes.modalidad_certificacion` y sus writers de actualización/alta fueron desplegados en STAGING y PRODUCCIÓN mediante las tres migraciones versionadas `202609170003`, `202609170004` y `202609190001`. Las 34 OC históricas de producción quedaron conservadoramente en `SIN_DEFINIR`.
- Las divergencias UM/ST que el fixture atribuía a producción (ausencia de `orden_id`, FK `CASCADE`, falta de índices únicos/policies restrictivas) **no representan el estado live verificado el 2026-09-29**: esos objetos ya estaban desplegados.
- **KI-040 / PR #85:** no tratar como migración pendiente automática. Producción expone v1/v2/v3 y el frontend vigente usa `coi_confirmar_etapa_circuito_v3`; cualquier cambio debe validarse contra v3.
- `tests/fixtures/production_schema_contract.json` fue regenerado en PR #111 con el estado live verificado el 2026-09-29.
- Permanecen como deuda separada KI-037 (alertas revisadas primarias en sessionStorage) y KI-038 (fotos OC/estación volátiles), que no fueron modificadas por esta reconciliación.

Regla para agentes: ante contradicción entre fixture y una auditoría live autorizada y fechada, reportar la diferencia y actualizar el contrato; no reaplicar migraciones por inferencia.
