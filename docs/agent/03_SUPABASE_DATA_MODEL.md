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

## Documentación de OC — camino activo

El camino documental **activo y único** es:

- los archivos viven en el bucket privado `coi-documentos` de Supabase Storage;
- se indexan en `public.coi_documentos_oc`, que el módulo V58.1R28 lee y
  publica en la ficha (caché en memoria, nunca en localStorage).

H07 **no creó** ninguna tabla documental adicional. El intento inicial de darle
autoridad remota a las referencias externas de la V64 (`coi_documentacion_oc`
de localStorage: repositorio, ruta, «Carpeta documental OneDrive», links) fue
**retirado** en el PR #61: contradecía AGENTS.md y BASELINE_OPERATIVA, que
establecen que OneDrive y `Agregar link documental` no se reintroducen y que
Storage más las tablas vigentes son el camino activo. Ver KI-019 y TD-049.

El material histórico de esa clave se conserva intacto, fuera del modelo
operacional, contable y exportable por `__COI_DOC_H07_LEGACY__`.

Consecuencia para el Centro de Alertas: las alertas que pedían cargar el link de
una carpeta OneDrive/SharePoint o agregar una «referencia documental» externa
quedaron **filtradas**, porque dirigían a una acción retirada y —con el store
vacío— se disparaban para todas las OC. Las alertas documentales del camino
vigente («OC activa sin Acta de Inicio», «Falta expediente», «Falta última
acta», «Estado documental pendiente») siguen intactas. Ver TD-056 y `H07-21`.
