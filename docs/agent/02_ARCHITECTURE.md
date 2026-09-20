# 02 — ARCHITECTURE

## General
```text
Chrome / Edge
    ↓
index.html
HTML + CSS + JS
    ↓
Supabase JS
    ↓
PostgreSQL + Storage
```

## Capas lógicas
1. Presentación: cards, tablas, modales, filtros, navegación.
2. Estado UI: vista activa, filtros, selección, permisos, caches de sesión.
3. Dominio: vencimientos, certificaciones, CT, Obra/Servicio, Timeline, documentos.
4. Persistencia: PostgreSQL, Storage, Auth, RPC.
5. Compatibilidad: localStorage solo cache/legacy controlado.

## Supabase-first
Patrón:
acción → validar → persistir remoto → confirmar → actualizar cache/UI.

Evitar como flujo normal:
acción → guardar local → sincronizar después.

## Lecturas
Prioridad:
1. Supabase;
2. dato estructurado;
3. metadata documental como fallback explícito;
4. cache local documentada.

## Storage
Resolver PDF por bucket + path y signed URL cuando corresponda.

No usar como autoridad OneDrive legacy, links temporales viejos o rutas locales.

## Eventos JS
Preferir `addEventListener`.
Evitar múltiples listeners que compitan por la misma acción.

## Globals
Antes de agregar `window.*`, buscar colisiones y documentar dependencia.

## Riesgos del single-file
- funciones duplicadas;
- listeners duplicados;
- globals pisadas;
- orden de ejecución;
- referencias antes de inicialización;
- módulos legacy solapados;
- múltiples caches.

## Regla de cambio
Cambio mínimo. No usar un bug puntual para refactorizar zonas ajenas.

## Autoridad
Si código/migraciones contradicen este documento: investigar y actualizar documentación, no asumir.
