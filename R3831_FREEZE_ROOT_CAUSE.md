# R38.3.1 — Auditoría del bloqueo y rollback de emergencia

## Decisión de emergencia

El contenedor no dispone de Chromium, Chrome, Playwright ni otro navegador real. Por la regla de emergencia, `index.html` fue restaurado byte a byte desde `index_PRE_IMPUTACION_POSICIONES_R383.html` y sólo se cambiaron cadenas de versión, fecha y changelog. No se conserva código funcional de R38.3 en el archivo publicado.

No se declara que la causa productiva esté corregida ni que el freeze haya sido reproducido: la corrección aplicada es un **rollback seguro** a la última base conocida como estable. La comprobación real queda en el workflow Chromium del PR.

## Base y comparación

- HEAD disponible al comenzar: `d7798cc`, versión R38.3.
- El objeto del merge productivo `8c53b5e0071ff6ca8769b3ace3ca92c2e87b8474` y su padre no existen en el clon entregado, que tampoco contiene una referencia local `main`; por ello no fue posible ejecutar esa tercera comparación por objeto Git.
- El backup sí contiene `V58.1R38.2-CONTROL-TERCEROS-FIX` y las funciones `ctEditState`, `setControlTercerosEditMode`, `cancelarEdicionControlTerceros`, `saveCTFromButton`, `todasLasOC` y `coiParseMontoAR`.
- La diferencia funcional entre el hotfix y el backup estable es cero. El diff restante contiene exclusivamente versión, fecha y entrada de changelog.

## Hallazgos de la auditoría estática

El snapshot R38.3 contenía 8 construcciones `MutationObserver`, 3 observaciones de `document.body`, 144 registros `document.addEventListener` y 3 usos de `setInterval`. El inventario completo está en `R3831_AUDIT_PRE_ROLLBACK.log`.

### Camino nuevo de mayor riesgo

R38.3 registraba durante `initR31` listeners globales permanentes de `input` y `change` sobre `document`. Para un input financiero, la cadena era:

1. listener global `input`;
2. `finR383ActualizarFila`;
3. `obtenerPosicionesFinancierasPorOC`;
4. `finV56MigrarMemoria`;
5. `posicionesFinancieras.map(normalizarRegistroFinanciero)`;
6. `normalizarRegistroFinanciero` consulta `finBuscarOC` y normaliza el registro completo.

Esto convierte una pulsación en una migración de todas las posiciones y búsquedas repetidas sobre las OCs. La complejidad efectiva puede aproximarse a `O(P × O)` por tecla, además de asignar un arreglo completo. `finR383ActualizarConteo` también recorría todos los checks seleccionados visibles. No se encontró recursión directa entre las funciones auditadas, ni un MutationObserver financiero nuevo, ni render completo de la ficha por tecla. Sí se encontró un listener global adicional y trabajo global impropio dentro del handler de una fila.

### Arranque

`initR31` también llamaba `finV56MigrarMemoria()` durante el boot. Esa llamada ya existía en el backup R38.2; lo nuevo y riesgoso fue conectar nuevamente esa operación global al ciclo reactivo por tecla. `finR383ActualizarFila` y `finR383ActualizarConteo` no eran invocadas explícitamente durante el arranque, aunque sus listeners se instalaban globalmente durante el boot.

Por falta de navegador y datos productivos no hay una medición `performance.now()` que permita atribuir de forma concluyente el congelamiento inmediatamente posterior al render de Red Línea Roca a una única función. La **causa exacta reproducida queda NO DETERMINADA**. El defecto de rendimiento confirmado estáticamente es la migración/búsqueda global desde el listener de input R38.3; la correlación temporal con el incidente justifica retirar todo R38.3, no mantener una corrección especulativa.

## Código retirado y conservado

Retirado junto con todo el cambio funcional R38.3:

- sustitución global de `normalizarPOS` y `finR31MostrarPOS`;
- nueva tabla e inputs reactivos;
- `finR383ActualizarFila` y `finR383ActualizarConteo`;
- listeners globales R38.3;
- flujo R38.3 de `consumirPosicionesOC`.

Conservado íntegramente desde R38.2:

- login/logout y Supabase;
- Dashboard, Red, Calendario, Órdenes, Carga, Administración y Alertas;
- Fase 11, capa visual, Analítica de Órdenes;
- Control de Terceros y sus cuatro símbolos requeridos;
- hotfix `todasLasOC`, `coiParseMontoAR` y Financiero estable.

La imputación por cantidades se difiere a otra rama, donde deberá ser lazy, acotada al contenedor y validada en navegador antes de volver a producción.

## E2E y prueba A/B

Se agregó un workflow Playwright/Chromium que sirve ambos HTML bajo una subruta tipo GitHub Pages, instala un mock local de Supabase, navega con clicks reales por los nueve accesos solicitados, mantiene el rollback abierto 10 minutos y registra errores, rechazos, long tasks, heap, listeners, observers y timers. Compara R38.2 contra el rollback, que funcionalmente es el mismo archivo.

Estado local: `NOT_RUN_NO_BROWSER`. Estado CI: pendiente de ejecución en el Pull Request. Hasta que GitHub Actions quede verde no se afirma recuperación comprobada, E2E exitoso ni ausencia de regresión.

## Datos productivos

No se inició sesión, no se llamó Supabase productivo y no hubo escrituras productivas. Todas las comprobaciones fueron estáticas/locales.
