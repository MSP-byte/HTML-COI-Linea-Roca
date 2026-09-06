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

## Backup maestro V58.1 — snapshots autoritativos vs. volcado de recuperación

El payload del backup separa dos cosas que no se pueden mezclar:

- **`autoritativo`** — snapshots confirmados contra Supabase. Hoy contiene
  `timeline: { confirmado, fuente, tabla, eventos }`. Se llena únicamente cuando
  `COI_TIMELINE_COI.isAuthoritativeReady()` es `true`; el origen es el snapshot
  en memoria (`window.coiTimelineEvents`), nunca localStorage.
- **`localStorage`** — volcado crudo del navegador. Material de recuperación sin
  autoridad. Es donde puede aparecer el legado en cuarentena.

`resumen.totalEventosTimeline` vale `0` para un Timeline vacío **confirmado** y
`null` cuando no hubo lectura confirmada: vacío no es lo mismo que ausente.

El restore prioriza `autoritativo.timeline` y aplica siempre la ruta remota
canónica `COI_TIMELINE_COI.replace`. La caché retirada
`coi_timeline_events_v1` no se reescribe en ningún caso. Los backups anteriores
a H07 se siguen aceptando leyendo esa clave dentro de `payload.localStorage`,
pero solo como formato legado de importación. Ver TD-059 y `H07-30`…`H07-33`.

`replace()` puede devolver `{discarded:true}`: la escritura llegó a Supabase pero
una operación concurrente la invalidó y no se publicó. En ese caso el restore
**no** se declara exitoso, no recarga y avisa que se descartó; la traza
`coi_v581_backup_meta.timeline` guarda `restaurado`, `descartado` o `ausente`.
Ver TD-062 y `H07-38`/`H07-39`.

El marcador de corte de la cuarentena de observaciones
(`coi_observaciones_h03_imported_v1`) ya no es un `'1'`: guarda la huella del
contenido legado conciliado, de modo que una fila que aparezca después reabre la
cuarentena en vez de quedar oculta. Ver TD-060.

## Cachés retiradas: solo se descartan

`coi_cache_posiciones_oc_supabase_v1` y `coi_supabase_ordenes_cache_v2` están
retiradas (KI-021). Sobre ellas la única operación admitida es `removeItem`:
ningún camino —tampoco los de borrado— puede leerlas, filtrarlas y volver a
guardarlas, porque eso reescribe datos operativos en reposo. Ver TD-058.

`coi_supabase_estaciones_cache_v1` **no** está retirada: sigue siendo una caché
activa del camino normal.

### Sección de recuperación del backup

El escudo hace que `localStorage.getItem('coi_observaciones_oc')` devuelva `[]` a
cualquier consumidor operativo, y `snapshotLocalStorage()` usa ese mismo getter.
Para que el material en cuarentena no quede sin respaldo, el payload lleva una
tercera sección:

```
recuperacion: {
  observacionesLegacy: { autoritativo: false, clave, filas, pendientes }
}
```

Se lee por `__COI_OBS_H07_CUARENTENA__`, que usa el getter nativo. No alimenta
KPIs, no se mezcla con `datos.observacionesOC` —que sigue siendo solo lo
confirmado contra Supabase— y el importador **no la reimporta**: avisa que el
archivo la trae y la conserva como material de recuperación explícita. Ver TD-067
y `H07-47`…`H07-49`.

### Documentación en Ficha OC

El panel 5 muestra únicamente la sección `[data-documentos-storage]`, alimentada
por `public.coi_documentos_oc` y el bucket `coi-documentos`. El renderizador del
modelo por referencia externa quedó neutralizado: no puede emitir la tarjeta
«Carpeta documental OneDrive», los campos de repositorio/ruta/link, «Abrir
carpeta documental», «Copiar estructura sugerida OneDrive», el modal de
referencias externas ni los exports CSV legados. Ver TD-065, TD-066, KI-026.
