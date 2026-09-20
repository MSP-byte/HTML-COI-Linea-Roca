# Control de Terceros — informe de corrección

## Alcance y versión

- Rama: `fix/control-terceros-editar-cancelar`.
- Base auditada: el `index.html` actual, respaldado sin modificaciones como
  `index_PRE_CONTROL_TERCEROS_FIX.html`.
- Versión resultante: `V58.1R38.2-CONTROL-TERCEROS-FIX`.
- No se hicieron escrituras de prueba contra Supabase productivo.

## Auditoría previa y causa raíz

La implementación activa se encuentra en el bloque
`coi-v581r28-contractual-ct-script`. Es la única implementación que genera los
controles con atributos `data-r28-ct-*`; no hay shadowing de `renderCTCard`,
`injectCT` ni `saveCTFromButton` dentro de ese IIFE.

1. **HTML generado:** `renderCTCard()` crea la tarjeta KPI y
   `renderCTContractualBox()` crea la representación de la pestaña Contractual.
2. **Selectores:** `data-r28-ct-card`, `data-r28-ct-contractual`,
   `data-r28-ct-edit`, `data-r28-ct-editor`, `data-r28-ct-input`,
   `data-r28-ct-save` y `data-r28-ct-cancel`.
3. **Render:** `injectCT()` elimina las instancias previas y vuelve a insertarlas
   con `insertAdjacentHTML`. Además, `wrapRender()` decora el `renderFichaOC`
   vigente y vuelve a invocar `injectCT()` después de cada render.
4. **Guardado:** `saveCTFromButton()` actualiza memoria/caché y delega la
   persistencia a `syncCTSupabase()`.
5. **Listener Editar:** existía una rama en un único listener delegado de captura
   registrado sobre `document`.
6. **Listener Cancelar:** existía otra rama en ese mismo listener.
7. **Cantidad:** el listener de Control de Terceros se registra una vez al cargar
   el IIFE. La delegación sobre `document` sí sobrevive al reemplazo del HTML; no
   se agregaron listeners por render.
8. **Reemplazo de nodos:** sí. `injectCT()` elimina y recrea ambas vistas. Los
   nodos y cualquier estado guardado solamente en ellos se pierden.
9. **Shadowing:** hay varias definiciones históricas globales de
   `renderFichaOC`, y varios wrappers encadenados, pero una sola implementación
   `data-r28-ct-*`. Se modificó exclusivamente la que gana para esta tarjeta.
10. **Implementaciones históricas:** las demás apariciones de “Control de
    Terceros” pertenecen a documentos, timeline o estados contractuales; no son
    otro editor de la fecha Hasta.

La causa funcional exacta no era que la delegación desapareciera: **Editar sólo
alternaba `hidden` y Cancelar sólo volvía a ocultar el contenedor**. No existía un
modo de edición, una copia del valor original ni restauración. El campo de la
vista Contractual, además, se mostraba editable y con Guardar desde el inicio.
Al recrear la tarjeta mediante HTML se perdía todo estado puramente DOM, dando la
impresión de botones sin listener y obligando a recomenzar el flujo.

## Comportamiento nuevo

- `ctEditState` mantiene un borrador temporal con `nroOC`, `valorOriginal`,
  `valorEdicion` y `modoEdicion`, sin escribirlo en Supabase o localStorage.
- `setControlTercerosEditMode()` centraliza visibilidad y estado `disabled`, y
  enfoca el input al editar.
- `cancelarEdicionControlTerceros()` restaura exactamente el snapshot y vuelve a
  lectura sin llamar a ninguna función de persistencia.
- Guardar sólo se acepta durante una edición de la OC abierta. Tras una única
  operación, limpia el borrador, recrea la tarjeta/badge y conserva la
  interacción mediante el listener delegado existente.
- Un re-render de la misma OC recompone el modo activo; abrir otra OC descarta el
  borrador sin escritura.
- Los controles sólo se generan cuando `canEdit()` confirma los permisos ya
  existentes. No se modificaron autenticación, login ni RLS.

## Persistencia confirmada en código

- Tabla: `coi_ordenes`.
- Columnas: `control_terceros_hasta` y `control_terceros_estado`.
- Resolución: `findOrder()` obtiene el objeto abierto y `orderNro()` su número de
  OC normalizado.
- Filtro: `update(...).eq('nro_oc', nro)`. Esta implementación no usa UUID para
  Control de Terceros; actualiza por `nro_oc` y no hace insert/upsert.

## Fechas

`fechaISO()` continúa aceptando el formato histórico `DD/MM/YYYY`, pero el valor
normalizado para `<input type="date">` y Supabase es `YYYY-MM-DD`. Ahora valida
el calendario real y rechaza vacíos, valores inválidos y años anteriores a 2000,
incluidos `0001-01-01`, `01/01/0001`, `Invalid Date`, `null` y `undefined`.
Estos valores se presentan como “Sin fecha” al leer datos existentes y nunca
como vigencia válida. Un intento de guardarlos muestra un mensaje y no modifica
memoria, caché ni Supabase.

## Pruebas

- `tests/check_control_terceros_static.js` valida versión, selectores,
  persistencia existente, validación y ausencia de `onclick` inline.
- Los 33 scripts inline de `index.html` se extrajeron y validaron con
  `node --check` sin errores.
- `tests/test_control_terceros_browser.py` sirve el archivo por HTTP y define una
  fixture con `2026-08-31`. Intercepta Supabase con un mock y cubre Editar,
  Cancelar, Guardar único, re-render, cambio de OC, permisos y fechas inválidas.
- La ejecución de navegador quedó bloqueada en este contenedor: no incluye
  Selenium/Chromium y las instalaciones por npm/apt fueron rechazadas con HTTP
  403. El registro está en `TEST_CONTROL_TERCEROS_BROWSER.log` y el resultado
  estructurado en `TEST_CONTROL_TERCEROS_RESULTS.json`. Por esa limitación no se
  generó una captura real ni se declara aquí una validación de navegador exitosa.

## Riesgos pendientes

- Ejecutar la suite Selenium en CI o en un equipo con Chrome/Chromium para cerrar
  la validación visual, recarga real y regresión de navegación completa.
- La persistencia sigue la política preexistente de fallback local cuando la
  columna o la red de Supabase no están disponibles; no se cambió ese contrato.

## Archivos

- `index.html`: corrección y versión.
- `index_PRE_CONTROL_TERCEROS_FIX.html`: respaldo exacto previo.
- `tests/test_control_terceros_browser.py`: suite de navegador con mock.
- `tests/check_control_terceros_static.js`: controles deterministas.
- `TEST_CONTROL_TERCEROS_RESULTS.json`: resultado estructurado.
- `TEST_CONTROL_TERCEROS_STATIC.log` y
  `TEST_CONTROL_TERCEROS_BROWSER.log`: registros de ejecución.
