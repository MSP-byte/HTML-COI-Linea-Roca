# Fase 1 — Auditoría del borrado de Órdenes de Compra

**Fecha:** 2026-07-29  
**Versión:** `V60.1-CRUD-OC-PERSISTENTE`

## Causa raíz confirmada

El flujo visible estaba dividido entre implementaciones incompatibles:

- `v45BorrarSeleccionadas` eliminaba exclusivamente de los arrays `estaciones` y de `localStorage`.
- `eliminarSeleccionadasSupabase` recorría las OCs y llamaba a `eliminarOrdenEnSupabase`, pero no reutilizaba el PIN administrativo, no verificaba dependencias y declaraba éxito usando la cantidad seleccionada.
- `eliminarOrdenEnSupabase` pedía filas con `select()`, pero no comprobaba que Supabase hubiera devuelto exactamente una fila. Una respuesta vacía —por filtro que no coincidía o una política RLS— era tratada como éxito.
- El borrado múltiple ejecutaba operaciones independientes y recargaba después de cada fila. No existía una confirmación global de cantidad ni una purga central de caché.

Por esto una eliminación local o un DELETE remoto no confirmado podía aparentar éxito y, al reconstruir la vista desde `public.coi_ordenes`, la OC reaparecía.

## Flujo implementado

`eliminarOrdenesPersistentes` centraliza selección individual y múltiple, bloquea doble ejecución, valida modo Administrador, sesión/conectividad Supabase, dependencias y confirmación accesible con el PIN existente más la frase `ELIMINAR`.

La clave preferida es `coi_ordenes.id`; el fallback es `nro_oc` normalizado como texto. El normalizador quita el prefijo visual `OC-`, espacios y conserva ceros significativos.

Antes del DELETE principal se consultan únicamente tablas observadas en `index.html`: `coi_documentos_oc`, `coi_certificaciones`, `coi_historial_oc`, `coi_links_documentales`, `coi_auditorias_calidad` y `coi_timeline_events`. Cualquier dato o error de inspección bloquea esa OC. `coi_ordenes_estaciones` es la única relación segura: se filtra por `orden_id` y `nro_oc`; sus filas se restauran si el DELETE principal falla.

El DELETE de `coi_ordenes` siempre usa `.in('id', ids)` o `.in('nro_oc', numeros)` con listas validadas y solicita `select('id,nro_oc')`. Luego se compara la cardinalidad, se relee la tabla y se confirma ausencia. Solo entonces se reemplaza `coi_supabase_ordenes_cache_v2` y se recargan las vistas desde Supabase.

No se invoca Storage, no se borran PDFs, no se usa `service_role` ni se modifican RLS.
