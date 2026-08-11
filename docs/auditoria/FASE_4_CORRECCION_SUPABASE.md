# Fase 4 — Corrección Supabase e integridad transaccional

## Resultado

La aplicación quedó preparada para usar Supabase como única fuente operativa y
para confirmar movimientos críticos sólo después del commit PostgreSQL.

| Problema | Causa raíz | Solución | Riesgo de regresión | Validación |
| --- | --- | --- | --- | --- |
| Éxito financiero falso | La UI creaba una copia local y luego mostraba éxito | RPC `coi_certificar_posiciones` y espera explícita del resultado | Contrato SQL aún no aplicado en producción | Test de rechazo y éxito frontend; PostgreSQL embebido |
| Consumos duplicados | Reintentos sin clave estable | Registro de idempotencia y comparación del payload | Una integración externa podría reutilizar mal una clave | Reintento idéntico no duplica; payload distinto se rechaza |
| Saldo negativo o desactualizado | Totales derivados escritos desde cliente | Trigger y locks sobre la posición | Datos históricos incompatibles con sus totales | Captura de baseline y test de recálculo |
| Eliminación de certificaciones | `DELETE` destruía trazabilidad | Estado `ANULADA`, motivo, usuario y fecha | El usuario debe comprender el nuevo circuito | Test de anulación y restitución de saldo |
| Edición parcial OC/estación | Dos actualizaciones independientes | RPC integral y trigger de estación principal | OCs sin estación principal no permiten cambiar ubicación | Test de commit conjunto |
| Borrado parcial de OC | El navegador borraba la OC y luego intentaba reparar estaciones | RPC `coi_eliminar_orden_integral`; bloquea toda dependencia trazable | Una OC con historial deja de ser eliminable por diseño | Rechazo con dependencias y commit de OC libre en PostgreSQL embebido |
| Circuito sin historial | Estado e historial viajaban en requests separados con rollback manual | RPC idempotente `coi_confirmar_etapa_circuito` | Etapas históricas con código legacy requieren reconciliación | Reintento de etapa no duplica el evento |
| Dos links principales | Desmarcar y marcar eran dos requests independientes | RPC `coi_guardar_link_documental` más índice único parcial | Duplicados históricos abortan la migración hasta corrección manual | Dos altas principales dejan exactamente una activa |
| Permisos sólo visuales | Botones ocultos sin autoridad de servidor | RLS, roles activos y RPC `security definer` con validación explícita | Políticas históricas deben convivir con las restrictivas | Test de rol consulta rechazado |
| Caché operativa tras logout | Caché leída sin sesión | Purga selectiva y carga offline sólo con sesión autenticada | Ninguno conocido | Test estático y smoke runtime |

## Decisiones de diseño

- No se migró a un framework ni se agregó un servidor propio.
- `coi_certificaciones` conserva su circuito documental; el libro financiero se
  separa en `coi_consumos_posicion` para no mezclar contratos de datos.
- Una corrección financiera no reescribe importe ni cantidad: anula el asiento y
  genera uno nuevo.
- Los duplicados se informan y bloquean los índices; nunca se eliminan solos.
- El contrato preserva como baseline cualquier consumo histórico materializado
  en `coi_posiciones_oc`.
- Historial y links documentales forman parte de la trazabilidad de la OC. El
  frontend puede leerlos, pero las mutaciones compuestas se realizan por RPC.

## Condición para producción

El código y las migraciones pasan pruebas locales reproducibles. El estado
productivo seguirá siendo **estable con observaciones** hasta aplicar las
migraciones en staging/producción, verificar perfiles y completar el smoke test
con una cuenta real autorizada.
