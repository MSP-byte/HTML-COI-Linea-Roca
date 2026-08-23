# COI Línea Roca — Baseline Operativa Estable

Fecha de cierre: 2026-08-22

## Baseline funcional
Commit funcional validado antes del cierre documental:
`d3078c30f4c1f2a08e466d5887d463883ed5e2bb`

Este baseline incorpora los PR:
- #33 — Ficha Obras, contractual Supabase y Centro de Alertas.
- #34 — Timeline: layout y enlace documental válido.
- #35 — circuito contractual y Control de Terceros.
- #36 — lectura Supabase-first de Control de Terceros y retiro de PyC activo.
- #37 — UX final de Alertas y limpieza de filtros en Órdenes.

## Arquitectura vigente
HTML / CSS / JavaScript → Supabase JS v2 → PostgreSQL + Storage.

Supabase es la fuente única de verdad. `localStorage` no puede funcionar como autoridad de datos.

## Estado funcional validado

### Ficha OC
- apertura y navegación correctas;
- edición integral contra Supabase;
- eliminación funcional;
- Timeline corregido;
- documentación legacy retirada;
- Storage/documentación vigente preservados.

### Circuito contractual
- 12 etapas activas;
- cambio de etapa autorizado con persistencia remota;
- modo lectura para usuarios sin permiso;
- reingreso a etapas soportado donde corresponde;
- `finalizada_saldo_remanente` mantiene semántica propia.

### Control de Terceros
- lectura desde Supabase;
- fecha y estado visibles en Ficha;
- edición rápida disponible para administradores;
- edición desde Editar OC persistente;
- estado derivado desde fecha;
- readback y comportamiento fail-closed.

### PyC
Retirado del frontend operativo activo:
- no hay etapa `enviada_pyc`;
- no hay botón `Marcar enviada a PyC`;
- no hay KPI, badge, columna, alerta ni campos de edición PyC activos.

Las columnas PostgreSQL legacy pueden permanecer temporalmente como histórico inerte.

### Centro de Alertas
- eliminados chips legacy sin utilidad;
- cabecera consolidada;
- tabla ordenada y responsive;
- acciones preservadas;
- mobile usa scroll horizontal controlado.

### Inicio operativo → Órdenes
- KPIs abren Órdenes con filtro contextual;
- banner informa filtro Dashboard;
- `Quitar filtro` elimina solo el filtro Dashboard y conserva filtros manuales;
- `Limpiar filtros` elimina filtros manuales + Dashboard;
- no reaparece estado fantasma al volver al módulo.

### Documentación
No reintroducir:
- OneDrive en Ficha OC;
- `Agregar link documental`;
- botón `Marcar enviada a PyC`.

## Validaciones de cierre
Durante la estabilización se ejecutaron:
- `npm test`;
- Quality Gates sucesivos en GitHub Actions;
- interacción Chromium;
- Playwright desktop/mobile;
- revisión de contratos reales de Supabase cuando fue necesario;
- smoke manual en GitHub Pages.

Último smoke manual validado:
- Control de Terceros persiste y actualiza correctamente;
- 12 pasos contractuales correctos;
- PyC ausente del frontend activo;
- Centro de Alertas limpio y funcional;
- filtros Dashboard/Órdenes se pueden quitar y limpiar correctamente.

## Regla de mantenimiento desde este punto
Trabajar por cambios acotados:

`bug/mejora concreta → rama → cambio mínimo → tests → PR → Quality Gate → revisión → merge → smoke`

Evitar auditorías generales o refactors masivos salvo que exista evidencia concreta de un defecto sistémico.

## Criterio de estabilidad
Este baseline se considera apto para uso operativo y carga progresiva de datos reales. Los nuevos hallazgos deben clasificarse como:
- bug operativo;
- mejora UX;
- deuda técnica;
- cambio funcional solicitado.

No mezclar categorías sin necesidad en un mismo PR.

## Release objetivo
Tag/release objetivo del cierre:
`v1.0.0-operativa`

El tag debe apuntar al commit final de `main` después de integrar este cierre documental.