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

## coi_documentacion_oc (H07 · pendiente de rollout remoto)

Referencias documentales de OC del módulo V64: tipo, número, repositorio, ruta,
link externo (OneDrive/SharePoint) y estado documental. Es la autoridad que
sustituye a la clave localStorage `coi_documentacion_oc` (KI-019).

NO guarda archivos. Los PDF del bucket privado `coi-documentos` se siguen
indexando en `public.coi_documentos_oc`, que es una tabla distinta y con otro
propósito.

| Columna | Tipo | Nota |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `orden_id` | uuid NOT NULL | FK → `coi_ordenes(id)`, **ON DELETE RESTRICT** |
| `id_obra`, `id_servicio`, `tipo_registro` | text | identificadores de negocio heredados de V64 |
| `tipo_documento` | text NOT NULL | con CHECK de no vacío |
| `nro_documento`, `nombre_archivo`, `extension_archivo` | text | |
| `repositorio`, `ruta_documental`, `link_documento`, `link_carpeta` | text | referencia externa |
| `fecha_documento` | date | |
| `periodo`, `acta_nro` | text | |
| `estado_documento` | text NOT NULL | default `Pendiente` |
| `observaciones` | text | |
| `fecha_creacion`, `fecha_actualizacion` | timestamptz NOT NULL | versión server-side por `coi_version_servidor()` |

**No denormaliza `nro_oc`** a propósito: la identidad es `orden_id` y el número
vigente lo resuelve el cliente contra el catálogo de órdenes, de modo que una
renumeración no deja copias viejas (TD-046).

RLS: policy permisiva base para `authenticated` más cuatro RESTRICTIVE sobre
`public.coi_current_role()` — SELECT con perfil activo; INSERT, UPDATE y DELETE
solo `administrador`. Es el mismo modelo de roles de H04/H05: no se introduce
un sistema de permisos nuevo.

A diferencia de UM y ST, aquí SÍ existe policy DELETE: una referencia documental
es un puntero a un archivo externo, no historial operativo, y el módulo siempre
ofreció eliminarla sin tocar el archivo real.

Índices: `(orden_id)` y `(orden_id, fecha_documento desc nulls last)`.

Migración: `202609040001_h07_documentacion_oc.sql`. **NO aplicada en remoto**
(KI-022); declarada en `_divergencias_pendientes.tablas`.
