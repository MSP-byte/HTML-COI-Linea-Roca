# COI V3 — Evolución incremental sin regresiones

## Alcance del primer incremento (rama de trabajo)

- Catálogo vigente en el tooltip de Red Roca (abreviaturas validadas y pendiente cuando no hay match).
- Reutilización del lector XLSX local de Cartera V8 para hojas tabulares con encabezados detectables; no se incorpora dependencia JS externa.
- Centro de importación V3 montado en Carga Operativa (Carga manual existente intacta).
- Vista Cartera de Servicios derivada exclusivamente de `public.coi_ordenes`.
- Métricas de importe de Cartera Obras sobre OC únicas vinculadas, sin sumar ARS/USD.
- Conciliación read-only: OC existente con/sin cambios, OC nueva, tipo conflictivo, Excel multifila, OC malformada, faltantes.
- Cambio de columnas controlado, auditoría CSV y bloqueo si no hay sesión/lectura remota.

## Límites obligatorios del MVP

No se guarda ningún Excel en Supabase ni se actualizan OC. **No es todavía la migración funcional definitiva.** No se tocaron las certificaciones, estados contractuales, cierres ni HES. Se requiere analizar la hoja real de Servicios y el Excel final de Obras para homologar campos e identificar correctamente filas que son períodos, posiciones o avances y no nuevas OC.

Supabase STAGING: proyecto `brmrroikctfbtzwfewan` actualmente rechaza la conexión de lectura del conector (`password authentication failed for supabase_read_only_user`). No se debe probar escribiendo en producción.

## Criterio para habilitar persistencia

1. Comparar con datos representativos de ambas planillas; mapear llaves OC, id_obra, posición y período.
2. Esquema versionado de lotes/filas y trazabilidad, migrado y probado en STAGING (RLS, roles, operación idempotente).
3. RPC server-side transaccional para aplicar únicamente campos homologados, verificación de versión y rol.
4. Vista previa del `diff`, tratamiento explícito de celdas vacías y eliminación prohibida.
5. Confirmación de usuario y comprobación post-guardado, incluidas pruebas de repetición/reintentos.
6. Quality Gate en desktop y mobile, QA autenticado y verificación visual de ambas carteras y expediente único.
7. Recién entonces sustituir funcionalmente la carga manual por el importador; mantenerla como alternativa.

## Integridad financiera

Los montos mostrados son contractuales de `coi_ordenes`, no certificados ni saldo SAP. El monto de cada OC se incluye una sola vez cuando existe vínculo verificable, y se separan monedas. La conciliación no modifica vínculos.
