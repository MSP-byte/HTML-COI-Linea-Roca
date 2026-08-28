# 03 — SUPABASE DATA MODEL

## Principio
Supabase es la fuente única de verdad. Verificar migraciones/schema actual antes de modificar datos.

## coi_ordenes
Entidad principal de OCs.

Campos conceptuales:
- id;
- nro_oc;
- tipo;
- trabajo;
- proveedor;
- estación/sector;
- monto;
- fechas/plazo/vencimiento;
- próxima certificación;
- estados;
- observaciones;
- CT.

Regla: una OC lógica = un `nro_oc` único.

## coi_ordenes_estaciones
Relación OC ↔ estaciones. Una OC puede tener múltiples estaciones.

## coi_certificaciones
Entidad estructurada de certificaciones.

Puede incluir:
- OC;
- acta_medicion_nro;
- fecha_inicio/fecha_fin;
- ítem/posición;
- avance;
- monto;
- observaciones.

Si existe certificación estructurada válida, tiene prioridad para indicadores.

## coi_documentos_oc
Índice documental asociado a OCs.

Puede incluir:
- id;
- nro_oc;
- tipo_documento;
- nombre_documento;
- estado;
- observaciones;
- storage_bucket;
- storage_path;
- fecha_documento;
- metadata.

Una Acta puede existir acá sin certificación estructurada. Puede ser fallback de visualización claramente marcado como documental.

## coi_timeline_events
Trazabilidad por fecha/OC.

Puede incluir:
- fecha/hora;
- oc;
- proveedor;
- rubro;
- origen/tipo;
- título/descripción;
- documentos;
- acción pendiente;
- responsable;
- estado/riesgo;
- observaciones.

### Multi-OC
Individualizar OCs. No concatenar ni inventar.

## Storage
Bucket conocido: `coi-documentos`.

Identidad física preferida:
`bucket + storage_path normalizado`.

## Deduplicación
Prioridad:
1. bucket + storage_path;
2. identidad semántica inequívoca;
3. id de fila como último recurso.

Nunca deduplicar solo por número de Acta.

## Signed URL
Si no hay path resoluble, no ofrecer acción PDF falsa.

## CT
Persistencia en Supabase. Las reglas temporales de “hoy” deben usar fecha local coherente.

## Caches
Cache local siempre secundaria.

## Operaciones destructivas
Sin autorización: no DELETE, TRUNCATE, migraciones, RLS/RPC/schema, borrado Storage.

## Antes de modificar modelo
Revisar:
- `supabase/migrations`;
- SQL versionado;
- tests SQL;
- RPC;
- RLS;
- frontend consumidor.
