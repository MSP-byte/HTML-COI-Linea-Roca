# Imputación por POS y cantidades — V58.1R38.3

## Auditoría y causa raíz

La implementación que gana en runtime es el bloque
`coi-v581r31-financiero-posiciones-normalizadas`, situado después de V54, V55,
V56 y de los overrides R8. Sus declaraciones globales finales de
`normalizarPOS`, `finV56TablaOC`, `finV56TablaCert`, `finV56TablaLibre`,
`calcularPosicionesLibresOC`, `renderEstadoFinancieroOC` y
`consumirPosicionesOC` son las usadas por el listener delegado creado en V56.
R38 envuelve la **carga** financiera, pero no reemplaza el consumo R31.

Inventario de la implementación activa:

- Posiciones OC: `finV56TablaOC()`.
- Posiciones certificadas/consumidas: `finV56TablaCert()`.
- Posiciones libres: `calcularPosicionesLibresOC()` y `finV56TablaLibre()`.
- Resumen/saldos: `calcularResumenFinancieroOC()` y
  `finV56SaldoPosicion()`.
- Acción: `consumirPosicionesOC()`.
- Checkboxes: listener delegado V56 sobre `.chk-fin-pos-oc`; la función activa
  `finV56ActualizarSeleccion()` se reemplazó para leer cantidades por fila.
- Persistencia: `guardarPosicionesFinancieras()` sobre la clave localStorage
  `coi_posiciones_financieras`.
- Carga R38: sincroniza solamente `saldo_remanente` en `coi_ordenes` por
  `nro_oc`. No existe en el HTML actual una tabla Supabase de movimientos
  financieros ni columnas remotas documentadas para guardar el movimiento.

La causa raíz tenía cuatro partes: la tabla sólo enviaba el ID del checkbox; una
cantidad y un monto globales se compartían entre filas; la confirmación contaba
renglones como “posiciones”; y `normalizarPOS()` convertía el identificador a
`Number(...).toFixed(2)`, perdiendo la naturaleza textual y ceros contractuales.
Aunque el movimiento ya conservaba `idPosicionOrigen`, la UI no verificaba de
forma conjunta ID + OC + clave POS ni exponía los remanentes antes de confirmar.

## Implementación

### Identidad de la posición

`normalizarPOS()` ahora sólo trabaja con strings: trim, eliminación de espacios y
cambio de coma por punto para la clave. Nunca usa `Number` o `parseFloat`. Así,
`160,10` y `160.10` generan `160.10`, mientras `160.1`, `16010` y `160` siguen
siendo claves distintas.

El identificador maestro reutilizado es `idPosicionFinanciera`, que ya existía y
se guardaba en los movimientos como `idPosicionOrigen`. También se reconocen los
aliases existentes `position_id`, `posicion_id`, `id_financiero`, `uuid` e `id`.
Las filas y checkboxes incluyen `data-position-id`, `data-nro-oc` y
`data-pos-key`. Antes de imputar se verifican los tres contra el maestro y la OC
abierta. En el movimiento, el vínculo se conserva además como
`sourcePositionId` y `source_position_id`.

### UX, cálculo y validación

Cada maestro muestra cantidad original, consumida, disponible, input de cantidad
propio, precio unitario de sólo lectura, monto calculado, cantidad/monto
remanentes y estado. El input está deshabilitado hasta seleccionar su fila y se
recalcula mediante un único listener delegado `input` marcado con dataset para no
duplicarse después de re-renders.

Fórmulas, con redondeo monetario a dos decimales:

- `cantidadDisponible = cantidadOriginal - suma(cantidadImputada válida)`.
- `montoImputado = round(cantidadImputada × precioUnitario, 2)`.
- `cantidadRemanente = cantidadDisponible - cantidadImputada`.
- `montoRemanente = round(cantidadRemanente × precioUnitario, 2)`.

La posición maestra nunca se muta ni elimina. Los libres se derivan siempre del
maestro menos los movimientos, evitando doble descuento. Cero/vacío, exceso,
maestro ausente, OC distinta, clave POS distinta, precio inválido y maestro ya
consumido se rechazan antes de confirmar. El botón queda bloqueado durante la
operación y el array se revierte si falla la persistencia local.

La confirmación enumera OC, POS, descripción, disponible, cantidad, precio,
monto y remanentes de cada fila, más renglones, unidades e importe total. La
multiselección conserva una cantidad independiente por maestro.

### Movimiento trazable

Cada imputación agrega —sin sobrescribir movimientos anteriores— un registro
`CERTIFICADA`/`IMPUTACION_POSICION` con ID único, maestro, OC, POS visible y
canónica, descripción heredada, cantidad, precio, monto, acumulados anterior y
nuevo, remanentes, fecha, usuario/rol y referencias opcionales existentes. La
vista Certificadas muestra la referencia al maestro y fecha de imputación.

## Persistencia y Supabase

El modelo financiero actual es local-first y persiste el maestro y movimientos
en `coi_posiciones_financieras`. Posiciones Libres no se almacena: es calculada.
No se inventó una tabla o columna Supabase. La única sincronización financiera
remota presente en R38 usa `coi_ordenes.saldo_remanente`; no transporta detalles
de movimientos. Por tanto, la trazabilidad detallada incorporada persiste en la
fuente existente local/backup, pero una futura persistencia remota requerirá un
esquema aprobado. Ninguna prueba contactó Supabase productivo.

## Permisos y listeners

Los controles sólo se renderizan para los modos de edición existentes y llevan
`data-permission="financiero.consumir"`. Al confirmar también se valida
`usuarioTienePermisoAsync('financiero.consumir')`, con fallback al permiso de
edición previo. No se modificaron autenticación ni RLS. Los listeners existentes
siguen delegados sobre `document`; el nuevo listener de preview usa bind-once por
`document.documentElement.dataset.finR383Delegated`.

## Pruebas y resultado

- `tests/test_imputacion_posiciones_core.js` ejecuta las funciones exactas
  extraídas de `index.html` y verifica POS textual y el caso 4 × 356126.40.
- `tests/check_imputacion_posiciones_static.js` audita el contrato estructural.
- Los 33 scripts inline pasaron `node --check`.
- `tests/test_imputacion_posiciones_browser.py` sirve `index.html` por HTTP,
  monta fixtures locales y cubre selección exacta, cancelación, parcial, total,
  exceso, multiselección y recarga, generando screenshot al completar el parcial.
- El contenedor no dispone de Selenium/Chromium y las instalaciones están
  bloqueadas por HTTP 403; por eso la suite de navegador no pudo ejecutarse aquí,
  no existe captura real y **no se declara el criterio final verificado en
  navegador**. Véanse el log y `TEST_IMPUTACION_POSICIONES_RESULTS.json`.

## Riesgos pendientes

1. Ejecutar la suite incluida en un runner con Chromium para cerrar la revisión
   visual, re-render, recarga y regresión integral.
2. Definir mediante migración aprobada una tabla remota de movimientos si se
   requiere trazabilidad Supabase multiusuario; el repositorio actual no contiene
   ese contrato y no se inventó uno.
3. El fallback por OC + POS para movimientos históricos sin ID se conserva por
   compatibilidad; todos los movimientos nuevos usan el ID maestro inequívoco.

## Archivos

- `index.html`.
- `index_PRE_IMPUTACION_POSICIONES_FIX.html`.
- `IMPUTACION_POSICIONES_FIX.md`.
- `TEST_IMPUTACION_POSICIONES_RESULTS.json` y logs.
- `tests/test_imputacion_posiciones_core.js`.
- `tests/check_imputacion_posiciones_static.js`.
- `tests/test_imputacion_posiciones_browser.py`.
