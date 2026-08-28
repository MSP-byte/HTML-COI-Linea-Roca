# 14 — TECHNICAL DECISIONS

## TD-001 — Supabase fuente única
localStorage solo cache/legacy.

## TD-002 — Single-file
`index.html` sigue como artefacto principal hasta decisión explícita.

## TD-003 — JS vanilla
No framework sin autorización.

## TD-004 — GitHub + PR + CI
Todo cambio relevante por rama/PR/Quality Gate.

## TD-005 — No merge automático
Autorización explícita.

## TD-006 — PDFs desde Supabase Storage
No OneDrive legacy como autoridad.

## TD-007 — Acta documental como fallback
Puede informar KPI cuando no hay certificación estructurada, marcada `(documental)`, sin inventar período/monto/avance.

## TD-008 — Playwright para regresiones UI
Tests estáticos solo complementarios.

## Formato nueva decisión
ID, fecha, contexto, decisión, alternativas, consecuencias, PR.
