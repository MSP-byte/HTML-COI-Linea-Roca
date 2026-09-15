# COI Línea Roca — `index.html`: cambios aplicados y auditoría de bugs

- **Archivo:** `index.html` (app single-file, ~2,28 MB)
- **Versión app:** V58.1R38.1-BOOT-FIX-FINANCIERO-OC
- **Fecha:** 2026-07-21
- **Backup del original sin cambios:** `index.html.bak`
- **Método de verificación:** reproducción real en Chrome headless (puppeteer-core),
  logueado a Supabase (36 OCs reales). Todos los "verificado" de abajo se midieron
  ejecutando la app, no por lectura de código.

Los cambios se aplicaron como **3 parches aditivos** (2 scripts al final del archivo +
1 edición mínima de una función), sin reescribir la lógica existente. Se pueden ubicar
buscando estas marcas dentro del archivo:
- `id="coi-hotfix-memo-todaslasoc"`  (fix del freeze)
- `id="coi-hotfix-parse-montos-ar"`  (fix de montos)
- `window.coiParseMontoAR`           (delegación agregada en `parseNumero`)

---

# PARTE A — CAMBIOS APLICADOS

## A.1 — Freeze total al Guardar en Carga → Financiera  ✅ ARREGLADO

**Síntoma:** estando logueado a Supabase, guardar una posición congelaba TODA la
pestaña (medido: **> 23 s**, indefinido). Offline no ocurría.

**Causa raíz (medida con el profiler de Chrome):** recursión mutua + recómputo sin caché.
`todasLasOC()` está envuelta 5 veces y re-decora TODAS las OCs (vigencia, saldo
remanente, vencimiento) en CADA llamada. En el guardado se la llamaba una vez por
posición:

```
todasLasOC()  → decora cada OC → obtenerSaldoRemanenteCertificable()
   → calcularResumenFinancieroOC() → obtenerPosicionesFinancierasPorOC()
   → finV56MigrarMemoria()  (re-normaliza TODAS las posiciones)
   → normalizarRegistroFinanciero() → finBuscarOC() → todasLasOC()  ↺ (re-entra)
```
Resultado: O(posiciones × órdenes × cálculo) → hilo principal bloqueado. Offline no
había órdenes que decorar, por eso no se colgaba.

**Solución** (script `id="coi-hotfix-memo-todaslasoc"` al final del archivo), 2 guardas
aditivas que NO cambian la lógica:
1. `todasLasOC()` memoizada por "ráfaga sincrónica": se computa 1 sola vez por
   operación.
2. `finV56MigrarMemoria()` (una MIGRACIÓN que solo hace falta 1 vez) con guarda
   anti-reentrada: corta la recursión mutua y corre 1 vez por ráfaga.

Ambas cachés se auto-limpian en el próximo *macrotask*, así que cualquier recarga de
datos o interacción posterior recomputa con datos frescos (sin riesgo de datos viejos).

**Verificado:** guardado de **> 23 s → 430 ms**, `blocked=false` en toda la ventana, la
fila se persiste correctamente.

---

## A.2 — Parseo de montos ARS con punto de miles (bug #1)  ✅ ARREGLADO

**Síntoma:** los montos escritos con punto de miles y sin coma decimal se corrompían, y
peor: había DOS parsers (`parseMontoARS` y `parseNumero`) que devolvían valores
DISTINTOS para el mismo texto.

Valores REALES reproducidos ANTES del fix (`parseMontoARS`):

| Entrada     | Antes        | Correcto |
|-------------|-------------:|---------:|
| `1.000`     | **1**        | 1000     |
| `2.000.000` | **2000**     | 2000000  |
| `102.976`   | **102.976**  | 102976   |
| `1.234.567` | **1234.567** | 1234567  |

Además `parseNumero` (el que usa el guardado real) daba `1.234.567` → 1234567, mientras
`parseMontoARS` daba 1234.567: el **mismo importe** quedaba distinto según el camino →
descuadre de saldos / certificados / libres.

**Solución** (script `id="coi-hotfix-parse-montos-ar"`): se define UN parser canónico
`coiParseMontoAR` y se usa en ambos caminos:
- `parseMontoARS` global se sobreescribe por el canónico.
- `parseNumero` (que es un *closure* del guardado R38, no se puede sobreescribir desde
  afuera) recibió una edición mínima: delega en `coiParseMontoAR` si está disponible
  (con *fallback* al comportamiento original si no).

Reglas del parser:
- Coma = decimal; punto = separador de miles.
- Miles AR limpios (`^\d{1,3}(\.\d{3})+$`): se quitan los puntos → `1.000`→1000,
  `2.000.000`→2000000, `102.976`→102976.
- Decimal estilo US cuando el número NO puede ser miles (`^\d+\.\d{1,2}$`): se respeta →
  `12.5`→12.5, `1234.56`→1234.56.
- Con coma: se quitan puntos y la coma pasa a punto → `102.975,84`→102975.84.

**Caso ambiguo asumido a favor de ARS:** `1.234` → 1234 (miles), no 1,234. Es lo
correcto para esta app (formato argentino).

**Verificado:** 12/12 casos correctos; y el guardado real de la fila del usuario
(`PRECIO_TOTAL = "$ 102.976"`) ahora persiste `precioTotal: 102976` (antes 102.976),
`precioUnitario: 102975.84`.

**Parsers NO tocados (fuera de alcance):** `normalizarMontoNumero` /
`obtenerMontoOC` (usados por el módulo de Órdenes, no por Carga Financiera). Si esos
también reciben montos con punto de miles, convendría unificarlos con el mismo
`coiParseMontoAR`.

---

# PARTE B — BUGS ENCONTRADOS

| # | Hallazgo | Estado |
|---|----------|--------|
| 1 | Montos ARS con punto de miles | **ARREGLADO** (Parte A.2) |
| 2 | Bloque OC/Certificada/Libre al guardar | Descartado — funciona bien |
| 3 | Funciones duplicadas (shadowing) | Confirmado — fragilidad, no rompe hoy |
| 4 | Tope duro de 4,5 MB (localStorage) | Confirmado — bomba de tiempo |
| 5 | Certificación: OC sin UUID | Latente — no se dispara hoy |

## Bug #2 — Detección del bloque financiero  → DESCARTADO (no es bug)
Sospecha: elegir "Certificada" podía guardar como "Posición OC". **Probado y funciona:**
al clickear el pill "Posiciones Certificadas" la grilla cambia a columnas de acta, la
fila queda con `data-bloque-financiero=CERTIFICADA` y se guarda como CERTIFICADA (con
acta y `montoCertificado` correctos). "Posiciones Libres" bloquea el guardado como
corresponde ("se calculan automáticamente…"). No hay desincronización.

## Bug #3 — Funciones duplicadas / shadowing  → CONFIRMADO (fragilidad)
Mismo nombre declarado varias veces a nivel global; gana la última, las anteriores
quedan MUERTAS. Verificado en runtime:
- `normalizarRegistroFinanciero`: gana la de la **línea ~22270** (`finR31Tipo`); la de
  la **línea ~6679** (`finV55InferirTipo`) es código muerto.
- `todasLasOC`: declarada 2 veces (~3143 y ~4630) + 5 wrappers encima.
- `normalizarPOS`, `leerFilaFinanciera`, etc. repetidos.

No rompe hoy, pero editar la copia equivocada en un arreglo futuro no tendría efecto.
Riesgo de mantenimiento alto en un archivo con decenas de capas "VxxRyy" superpuestas.

## Bug #4 — Tope duro de 4,5 MB al guardar  → CONFIRMADO (bomba de tiempo)
En `writeStoredPositions`:
```js
if(json.length > 4_500_000) throw new Error('La base financiera local supera el tamaño seguro…');
```
**Por qué existe:** las posiciones financieras se guardan como UN solo JSON en el
`localStorage` del navegador (clave `coi_posiciones_financieras`). `localStorage` tiene
cupo fijo por origen de ~5 MB (Chrome/Edge/Firefox); pasarse dispara
`QuotaExceededError` en medio del guardado. El chequeo de 4,5 MB corta antes con un
mensaje claro. Ese ~5 MB además se COMPARTE con otras claves (caché de órdenes,
estaciones, colas de sync), así que el espacio real es menor.

**Riesgo:** cuando la base crezca, el guardado deja de funcionar por completo (tira
error), no degrada suave. **Fix correcto:** persistir las posiciones en Supabase (como
ya hacen Órdenes y Certificaciones) o migrar a IndexedDB (cupo mucho mayor). No es un
bug activo hoy, pero es una limitación estructural.

## Bug #5 — Certificación: "OC existe pero sin UUID"  → LATENTE (no activo hoy)
En `resolverOrdenCertificacionPorNroOC`:
```js
orden_id: isUUID(row.id) ? row.id : null
```
y luego:
```js
if(!order?.orden_id){ error.code='OC_NOT_FOUND'; throw ... }  // "La OC existe pero no se pudo obtener su UUID"
```
**Estado:** NO se reproduce con los datos actuales — todos los `coi_ordenes.id`
consultados son UUID válidos (verificado). El camino de error es real pero no se dispara.

**Fragilidad detectada (inconsistencia):** el camino LOCAL (`buscarOrdenPorNroOC`)
devuelve el resultado si `orden_id` es *truthy* **sin validar que sea UUID**, mientras el
camino remoto sí anula los no-UUID. Si el índice local llegara a tener un `orden_id`
no-UUID, la certificación iría a Supabase con un FK inválido y fallaría con otro error.
**Recomendado:** validar `isUUID` también en el camino local.

---

# NOTAS DE ENTREGA
- Todos los cambios están dentro de `index.html` (self-contained, sin dependencias
  nuevas ni CDNs). Funcionan igual online y offline.
- El original intacto quedó en `index.html.bak` por si hay que comparar o revertir.
- Recomendación de prioridad para lo que queda: #4 (mover posiciones a Supabase) es lo
  más estructural; #3 y #5 son mejoras de robustez.
