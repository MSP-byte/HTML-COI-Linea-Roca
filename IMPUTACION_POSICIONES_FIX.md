# V58.1R38.3 — Imputación de posiciones por cantidad

## Base y alcance

- **Base de `main`:** `42648a0d1083bb2a892f5b64191463b5840d0945` (merge del PR #5).
- Se verificó antes de editar la versión `V58.1R38.2-CONTROL-TERCEROS-FIX` y la existencia de `ctEditState`, `setControlTercerosEditMode`, `cancelarEdicionControlTerceros` y `saveCTFromButton`.
- El cambio funcional se limita a **Expediente Digital OC → 4. Financiero → Posiciones OC**. No se reimplementó Control de Terceros.

## Causa raíz

La UI usaba una única cantidad/monto global para la selección y restringía el consumo parcial a una sola fila. Además, la clave POS se normalizaba mediante `Number`, perdiendo la representación contractual (`160,10`), y la confirmación sólo resumía el número de posiciones y el monto.

## Solución

- POS se conserva para presentación y se identifica con clave textual canónica (`160,10` → `160.10`), sin `parseFloat` ni coerción numérica.
- Cada maestro se resuelve por ID estable, OC normalizada y clave POS textual.
- Cada fila muestra cantidades original, consumida, disponible, a imputar y remanente; precio, monto a imputar y remanente; y estado.
- La confirmación detalla cada renglón y diferencia renglones de unidades.
- Cada POS confirmada genera exactamente un movimiento con vínculo al maestro, usuario/fecha y referencias disponibles. El maestro nunca se elimina.
- Posiciones Libres se deriva del original menos la suma de movimientos válidos, evitando doble descuento.

## Caso obligatorio

El fixture de OC `4530008964`, POS `160,10`, cantidad `5` y precio unitario `$356.126,40` confirma que imputar `4` produce `$1.424.505,60`, deja `1` y `$356.126,40`, y marca `PARCIAL`.

## Seguridad de datos

Las pruebas son locales y usan objetos en memoria. **No se realizaron escrituras en Supabase ni en ningún entorno productivo.**
