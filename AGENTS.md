# AGENTS.md — COI Línea Roca

## Estado actual
El repositorio estable es `MSP-byte/HTML-COI-Linea-Roca` y la rama de referencia es `main`.

Baseline funcional validado antes del cierre documental:
`d3078c30f4c1f2a08e466d5887d463883ed5e2bb`

Consultar `BASELINE_OPERATIVA.md` para el estado funcional consolidado.

## Arquitectura obligatoria
HTML / CSS / JavaScript → Supabase JS v2 → PostgreSQL + Storage.

- Supabase es la fuente única de verdad.
- `localStorage` puede ser caché, nunca autoridad.
- `coi_ordenes.id` (UUID) es la identidad técnica maestra.
- No introducir backend alternativo.
- No hacer refactors grandes salvo necesidad demostrada.

## Flujo de trabajo
Para cada bug o mejora concreta:
1. verificar HEAD actual de `main`;
2. crear rama dedicada;
3. aplicar cambio mínimo;
4. ejecutar tests pertinentes;
5. abrir PR;
6. exigir Quality Gate y Chromium verdes;
7. revisar semántica contra contratos reales de Supabase cuando corresponda;
8. mergear solo con autorización explícita;
9. hacer smoke posterior cuando el cambio afecte UX crítica.

## Producción
GitHub Pages publica desde `main`.

Las modificaciones de producto deben hacerse mediante rama y PR. No realizar escrituras de datos, cambios SQL, migraciones, RLS o RPC en Supabase producción sin autorización explícita.

## Reglas funcionales vigentes
- Circuito contractual activo: 12 etapas.
- Control de Terceros: Supabase-first, edición rápida autorizada, readback y fail-closed.
- PyC fue retirado de la arquitectura operativa activa del frontend.
- No reintroducir `Marcar enviada a PyC`, etapa `enviada_pyc`, KPIs/alertas/badges PyC ni campos PyC en Editar OC.
- No reintroducir OneDrive ni `Agregar link documental` en Ficha OC.
- Supabase Storage y las tablas documentales vigentes son el camino activo.
- Centro de Alertas no usa los chips legacy Operativas/Documentales/Financieras/Calidad de Datos/Todas.
- Órdenes permite quitar el filtro heredado del Dashboard y `Limpiar filtros` elimina filtros manuales + Dashboard.

## Validación mínima antes de merge
- `npm test`
- Quality Gate de GitHub Actions
- interacción Chromium
- `git diff --check`
- smoke manual cuando corresponda

Un Gate verde no reemplaza una revisión semántica cuando el cambio depende de contratos de Supabase.

Si el estado real contradice este documento, el repositorio real manda y la diferencia debe explicarse.