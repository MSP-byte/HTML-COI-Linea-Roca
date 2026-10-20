# COI V3 — Evolución incremental sin regresiones

## Criterio administrativo y QA de BASE_OBRAS V8 (19/10/2026)

Fuente auditada: archivo original `OBRAS_LGR_PANEL_V8(3).xlsx`, SHA-256 `57e4786a08c961f8aa674cdbefc5c4c8ff3a992f8961aa625bd419ebded0ff07`, hoja `BASE_OBRAS`, encabezados fila 3, intervenciones filas 4–120.

- 117 intervenciones con descripción y estado; 29 sin N.º de obra, 100 sin OC, 91 sin expediente, 100 sin acta de inicio. **Estos faltantes administrativos NO son errores ni deben impedir la alta de una intervención en cartera**.
- Los estados son: Enlace (72), En ejecución (10), Finalizada (9), Con Solped (7), Desestimada (6), Con Dictamen (4), Reemplazada (4), Planificada (3), Con Expediente (2). Se deben preservar como hechos del Excel y no reinterpretar como estados contractuales de una OC.
- 11 números administrativos repetidos en 22 filas (10, 31, 55, 46, 1, 2, 6, 3, 4, 7, 9); cada intervención se identifica por UUID de cartera, distinto de Nº obra, OC, expediente, fila y descripción. Los números repetidos tampoco prueban que las intervenciones sean duplicados.
- Carga inicial: crear UUID único por intervención. Cuando una reimportación cambie una firma descriptiva, exigir elección explícita de correspondencia existente o una nueva intervención; no insertar silenciosamente ni fusionar por coincidencia parcial.
- Mantener `null` cuando el dato aún no existe: ninguna OC nueva, fecha o monto se inventa. Los 17 números OC informados son referencias sujetas a validación contractual; el alta real de OC sigue un procedimiento independiente.
- El bloqueo legítimo de la persistencia no es «falta documentación», sino conflicto de identidad ambiguo no resuelto, error de formato, permiso insuficiente, esquema no disponible, o validación de versión obsoleta.

### Evidencia STAGING y gates de liberación
- Servicios: 16 registros guardados en STAGING, un lote y 16 auditorías. Reimportación RPC de los datos reales bajo `BEGIN/ROLLBACK`: 16 sin cambios, cero nuevos; recuentos persistentes intactos. PR HEAD anterior `b07fde9f`, Quality Gate #1097 6/6 success.
- El QA autenticado del HTML desplegado y actualizado al HEAD (Obras, recuperación de Servicios tras recarga, cierre de OC, certificaciones y navegación) sigue siendo un gate separado de las pruebas Playwright con mocks. No confundir datos guardados por el usuario con una prueba de la última versión desplegada.
- El respaldo productivo restaurable y las migraciones de producción requieren validación independiente: **no hay respaldo de producción verificado**. Un merge no equivale a despliegue SQL.
- Si no pueden completarse los gates de navegador/respaldo, mantener este PR en DRAFT sin merge; no inventar resultados ni cargar información productiva para suplir evidencia.


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
