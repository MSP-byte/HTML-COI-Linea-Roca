# Auditoria de interaccion por perfil de Chrome y GitHub Pages

Fecha de auditoria: 2026-07-21  
Rama: `fix/chrome-profile-interaction-github-pages`  
Version auditada: `V58.1R38.1-BOOT-FIX-FINANCIERO-OC`

## Alcance y resguardo

- Se trabajo sobre el `index.html` de `main` con commit base `d252b7c60d6ea010893ea0b6781c88b24585f544`.
- Se leyo `index-CAMBIOS-Y-BUGS.md` antes de editar. Al clonar `main`, ese archivo todavia no estaba versionado en la rama principal; se consulto la copia funcional proporcionada por el usuario.
- Backup exacto: `index_PRE_CHROME_PROFILE_FIX.html`.
- SHA-256 previo: `EDD92C702C6C7F1FE2CE2852E4D7A8F848F1D80A08247FC69C4845CDCB960C7F`.
- SHA-256 posterior: `ABF26057D3B06738D9250E06924C4F49295EF70A6E54190BB78235D9D33E84A3`.
- Se confirmaron y conservaron `coi-hotfix-memo-todaslasoc`, `coi-hotfix-parse-montos-ar` y `window.coiParseMontoAR`.
- No se borraron claves locales, no se cerro ninguna sesion y no se hicieron escrituras contra Supabase productivo.

## Conclusion

El bloqueo completo no se reprodujo en Chrome automatizado bajo siete estados limpios y persistentes. Por lo tanto, no se afirma que el problema haya quedado reproducido ni que una extension concreta sea la causa.

Se encontro una vulnerabilidad interna compatible con un fallo exclusivo de un perfil: todavia existia un `MutationObserver` continuo sobre el header y el footer para reescribir la version. Ese observer estaba en la copia previa alrededor de las lineas 18249-18262, pese a que R38.1 documentaba su retiro. Por si solo no se bloqueo durante las pruebas, pero una extension del perfil que modifique esas zonas puede producir una cadena de mutaciones cruzadas. Se retiro solo ese observer; la version sigue aplicandose con la funcion existente.

Se agrego instrumentacion para capturar la causa real en el perfil afectado. `?coiDebug=1` informa que elemento queda sobre cada boton y distingue indicios de nodos de extension. `COIRecuperarInterfaz()` no elimina nodos externos.

## Inventario estatico

Conteos sobre el `index.html` resultante, incluyendo la capa diagnostica:

| Categoria | Cantidad | Observacion |
|---|---:|---|
| `position: fixed` | 24 | Incluye footer, tooltips, toasts, modales y panel de diagnostico. |
| `inset: 0` | 11 | Principalmente modales legitimos y modos foco. |
| Reglas `pointer-events` | 14 | Las decoraciones usan `none`; los modales usan el comportamiento normal. |
| `z-index` >= 1000 | 21 | Tooltips, toasts, modales y diagnostico. |
| `addEventListener` | 370 | Acumulado historico del HTML monolitico. |
| Listeners con captura | 3 | Navegacion/filtros y guardado financiero, acotados por selector. |
| `preventDefault` | 143 | Acciones concretas de formularios, tabs y botones. |
| `stopPropagation` | 22 | Acciones concretas. |
| `stopImmediatePropagation` | 70 | Principalmente wrappers historicos por selector. |
| `MutationObserver` | 7 | El observer continuo de version fue eliminado. |
| `ResizeObserver` | 0 | No se detectaron. |
| `IntersectionObserver` | 1 | Ficha OC. |
| `setInterval` | 3 | Alertas activas, UM activa y conversion de estado/version heredada. |
| `setTimeout` | 182 | Inicializaciones, avisos y render diferido. |
| `requestAnimationFrame` | 14 | Graficos y render visual. |
| `onAuthStateChange` | 1 | Una suscripcion principal. |
| `createClient` Supabase | 1 | Un cliente principal. |
| Service workers / Cache Storage | 0 / 0 | No hay cache propia que explique diferencias de perfil. |

## Elementos que pueden cubrir el viewport

- `.op-modal`, linea aproximada 283: modal de calendario; solo se crea al abrir un detalle.
- `.doc-modal-overlay`, linea aproximada 526: modal documental; no existe en reposo.
- `body.orders-analytics-focus #vistaOrdenes`, linea aproximada 1424: modo foco deliberado.
- `.supabase-auth-modal`, lineas aproximadas 16029 y 16104: login; usa `hidden` y quedo oculto en reposo.
- `.exec-modal`, linea aproximada 16369: modal ejecutivo; no existe en reposo.
- `.circuito-historial-modal`, lineas aproximadas 18594-18601: historial contractual; no existe en reposo.
- `#coiBootIndicator`, lineas aproximadas 18683-18688: indicador pequeno, no cubre el viewport y se oculta en `finally`.
- `#coiInteractionDebugPanel`, linea aproximada 24056: solo aparece con `?coiDebug=1`, ocupa un rectangulo acotado debajo de la navegacion.

En los escenarios automatizados no quedo ningun overlay propio visible ni un elemento ajeno sobre los centros de los botones habilitados.

## Clases del body auditadas

- `auth-locked`: oculta la navegacion. Las rutas normales la remueven; la recuperacion solo la remueve con sesion confirmada.
- `modo-admin`, `modo-consulta`, `modo-jefatura`, `modo-visualizador`: permisos y visibilidad; los estados antiguos no bloquearon la navegacion.
- `dashboard-focus-mode`: oculta header/nav/footer de forma deliberada. La recuperacion solo la quita si la vista activa ya no es Dashboard.
- `orders-analytics-focus`: fija Ordenes a viewport completo. La recuperacion solo la quita si Ordenes ya no es la vista activa.
- `coi-booting`: no era aplicada por el codigo activo; el watchdog la reconoce y solo la quita vencida.
- `loading`: no se encontro una clase global de body activa.

## Observers, timers y arranque

- R38.1 desconecta `window.__coiV67Observer` al iniciar (linea aproximada 23903).
- El observer de version que quedaba activo fue eliminado. Ya no se observa header, footer ni `document.body` para reescribir la version.
- Permanecen observers funcionales acotados a seleccion de Ordenes, historial de edicion, cambios de rol, Centro de Alertas y Dashboard.
- Existe un observer historico sobre `document.body` para registrar historial despues de editar una OC (linea aproximada 16728). No se activo como bucle en las pruebas, pero queda como deuda de rendimiento.
- `bootstrapCOI()` tiene guarda `booting/ready` (lineas aproximadas 19674-19698), pero algunas esperas de red heredadas no tienen timeout propio.
- El nuevo watchdog de ocho segundos no repite ciclos. Si el DOM es interactivo marca modo local degradado; si hay sesion valida puede ocultar loaders propios vencidos y restaurar navegacion.
- La aplicacion publica `window.__COI_APP_READY = true` y emite `coi:ready` cuando el hit-test de navegacion confirma interaccion real.

## Causas posibles de interfaz no interactiva

| Causa | Evidencia | Condicion | Dependencia del perfil | Riesgo | Accion |
|---|---|---|---|---|---|
| Observer de version + mutacion externa | Observer continuo en la copia previa, lineas 18249-18262 | Header/footer modificados repetidamente | Si | Alto | Observer eliminado. |
| Elemento inyectado por extension | El diagnostico detecto correctamente un fixture `chrome-extension://` sobre todo el viewport | Extension activa solo en perfil principal | Si | Alto | Reportar, no eliminar. Validar en el perfil afectado. |
| Modal Supabase huerfano | Overlay `fixed; inset:0; z-index:10050` | `hidden` perdido o tarjeta inexistente | Puede | Medio | Diagnostico lo lista; recuperacion solo cierra backdrop propio sin tarjeta. |
| Arranque remoto pendiente | `bootstrapCOI()` espera Supabase y metadata en secuencia | Red, extension de privacidad o promesa pendiente | Si | Medio | Watchdog, estado degradado y diagnostico; no se borra cache ni sesion. |
| Clases foco fuera de su vista | Modos foco usan `position:fixed`/ocultan nav | Cambio de vista incompleto | No necesariamente | Medio | Recuperacion condicionada por vista activa. |
| Claves antiguas de modo/vista | Varias lecturas locales heredadas | Estado persistente incompatible | Si | Bajo | El escenario E no reprodujo bloqueo; no se borran claves. |
| Listener global indiscriminado | No se encontro uno que cancele todos los clics | N/A | No | Bajo | Los tres listeners capture estan filtrados por selector. |
| Service worker/cache propia | No existen | N/A | No | Descartado | Sin cambio. |

## Cambios realizados

1. Captura temprana y acotada de `error` y `unhandledrejection`, sin valores sensibles (linea 1481).
2. Retiro del `MutationObserver` continuo de version; `setVersion()` conserva `applyVersion()` sin observar DOM (lineas 18266-18274).
3. `window.COIDiagnosticoInteraccion()` (linea 24160).
4. `window.COIRecuperarInterfaz()` con lista permitida y validaciones (linea 24227).
5. Panel opcional `?coiDebug=1`, sin cubrir la navegacion y sin tokens.
6. Marcador `window.__COI_APP_READY`, evento `coi:ready` y watchdog unico de ocho segundos.

## Pruebas ejecutadas

El detalle completo esta en `TEST_CHROME_PROFILE_RESULTS.json` y las capturas en `tests/artifacts/`.

- A: contexto limpio equivalente a incognito.
- B: contexto persistente vacio.
- C: contexto persistente con localStorage previo y rol admin.
- D: sesion Supabase restaurada mediante mock.
- E: claves antiguas o invalidas de modo/vista.
- F: login simulado y recarga posterior.
- G: navegacion Ordenes -> Dashboard -> Red.
- Hit-test `elementFromPoint` sobre cada boton principal.
- Overlay externo simulado: detectado con `extensionHint=true`; `COIRecuperarInterfaz()` lo dejo intacto.
- Overlay/loader propio huerfano simulado: recuperado sin borrar datos.
- Carga financiera: cinco filas, asociacion a OC fixture, Ficha OC y navegacion posterior.
- Parser ARS: `1.000`, `2.000.000`, `102.976`, `102.975,84` y `12.5` pasaron.
- Permanencia de diez minutos: resultado registrado en `longRun` del JSON final.
- GitHub Pages publicado: HTTP 200, un solo `DOCTYPE` y version base R38.1 presente. La rama del PR se valido ademas bajo una subruta HTTP local equivalente.
- Sintaxis: 35 bloques JavaScript compilados con `new Function`; cero errores.
- Supabase productivo: cero credenciales y cero escrituras; CDN interceptado por un mock local.

## Riesgos pendientes

- La causa exacta del perfil principal solo puede confirmarse ejecutando `?coiDebug=1` en ese perfil y copiando el diagnostico mientras ocurre el bloqueo.
- El HTML mantiene alto volumen de listeners, timers y wrappers historicos. No se refactorizaron porque excedia el alcance y podia alterar modulos.
- La carga inicial del HTML monolitico fue de aproximadamente 5,4 a 6,9 segundos en Chrome headless local. Es rendimiento de parseo/arranque, no un overlay bloqueante.
- Un warning documental aparecio al abrir una Ficha OC fixture sin sesion en el escenario financiero; fue el control esperado de documentos Storage y no genero error ni bloqueo.

## Dictamen sobre extensiones

No hay evidencia suficiente para afirmar que una extension real sea la causa. Si el diagnostico del perfil afectado muestra `extensionHint: true` o una URL `chrome-extension://` en `blockingOverlays`, corresponde clasificarlo como:

> CAUSA EXTERNA AL INDEX.HTML: elemento inyectado por extension o configuracion del perfil de Chrome.

Hasta obtener esa captura, el dictamen permanece: **causa exacta no reproducida; susceptibilidad interna del observer de version corregida; diagnostico listo para aislar un bloqueo externo o propio**.
