# COI V3 — Evolución incremental sin regresiones

## Alcance del primer incremento (rama de trabajo)

- Catálogo vigente en el tooltip de Red Roca (abreviaturas validadas y pendiente cuando no hay match).
- Reutilización del lector XLSX local de Cartera V8 para hojas tabulares con encabezados detectables; no se incorpora dependencia JS externa.
- Centro de importación V3 montado en Carga Operativa (Carga manual existente intacta).
- Vista Cartera de Servicios derivada exclusivamente de `public.coi_ordenes`.
- Métricas de importe de Cartera Obras sobre OC únicas vinculadas, sin sumar ARS/USD.
- Conciliación read-only: OC existente con/sin cambios, OC nueva, tipo conflictivo, Excel multifila, OC malformada, faltantes.
- Cambio de columnas controlado, auditoría CSV y bloqueo si no hay sesión/lectura remota.

## Progreso adicional validado con archivos reales (16/10/2026)

- Obras V8: 117 intervenciones en `BASE_OBRAS`, 17 OC informadas, 10 encontradas en Supabase y 7 ausentes. Se detectaron 29 filas con denominación pero sin número de obra y números repetidos: se requiere homologación del identificador de cartera antes de aceptar todas las filas.
- Servicios: 16 OC en `BUSCADOR SVICIOS OC` (fila 6 como encabezado), 15 encontradas en Supabase y 1 no encontrada.
- Hoja `3 - (ACTA MEDICION)`: 246 filas con OC, varias por cada contrato; hoja `2 - (REMITO)`: 73 filas con OC. **No crear OCs desde esas filas**. Se corrigió el lector V3 para elegir explícitamente la hoja BUSCADOR fila 6 o BASE_OBRAS fila 3, con pruebas sintéticas XLSX en Chromium.
- Migración escrita en `supabase/migrations/202610160001_coi_v3_carteras_importacion.sql`: carteras aisladas, importaciones e ítems, RLS, rol Administrador, control optimista por huella y RPC transaccional. No se modifica `coi_ordenes`, posiciones, certificaciones ni cierres.
- Interfaz de confirmación de cartera incorporada, deshabilitada mientras el esquema no exista en el servidor o no haya conciliación y sesión autenticada.
- Intento de aplicación **solo en STAGING** rechazado: PostgreSQL `28P01 password authentication failed for user postgres`, además de la falla anterior de `supabase_read_only_user`. Migración no aplicada ni a STAGING ni a producción.

## Límites obligatorios del MVP

El guardado de carteras V3 existe a nivel de código y utiliza confirmación explícita, pero **permanece deshabilitado hasta validar y aplicar el esquema en STAGING**. No se actualizan OC desde las carteras. **No es todavía la migración funcional definitiva.** No se tocaron las certificaciones, estados contractuales, cierres ni HES. Las dos planillas reales ya se analizaron; siguen pendientes de homologación los identificadores de obras, equivalencias de estados, saldos declarados y vinculación del detalle de actas/remitos.

Supabase STAGING: proyecto `brmrroikctfbtzwfewan` rechaza tanto la conexión de lectura (`supabase_read_only_user`) como la aplicación de migraciones (`postgres`). No se debe probar escribiendo en producción.

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

## Alcance pendiente para declarar COI V3 completo

- Recuperar conexiones PostgreSQL del STAGING y ejecutar migración con rollback probado.
- Validar en entorno no productivo dos importaciones iguales (idempotencia), actualización legítima, conflictos, roles y revocación de permisos.
- Homologar claves permanentes de obra y período/posición para la futura carga detallada de actas y remitos.
- Implementar altas de OC mediante **flujo contractual separado** y confirmado; actualmente las OC ausentes solo quedan referenciadas como pendientes en la cartera.
- Hacer persistente la carga de cartera al abrir el HTML, sin exigir volver a subir el Excel para consultar datos confirmados.
- Completar expediente digital 360° sin duplicar fichas ni alterar navegaciones existentes.
- Verificar la interfaz autenticada con los Excel reales en desktop/móvil y revisar el flujo operativo de cierre, certificados y stock SAP.
- Ninguna modificación a `main` sin Quality Gate completo y smoke funcional.
